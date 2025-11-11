// Configurações e Variáveis Globais (Disponíveis no ambiente Canvas)
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Inicializa o Firebase e serviços
// Mantive as importações compat para o restante do código que funciona com Firestore
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app-compat.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth-compat.js";
import { getFirestore, doc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, addDoc, getDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore-compat.js";

// setLogLevel('debug'); // Descomente para debug

let app, auth, db;
let currentUserId = null;
let currentRole = null;
let confirmationResolver = null; // Para gerenciar o modal de confirmação

// --- FIREBASE INITIALIZATION ---

/**
 * Inicializa o Firebase e autentica o usuário.
 */
async function initializeFirebase() {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        // Define a persistência para 'session'
        await setPersistence(auth, browserSessionPersistence);
        
        // Autenticação com o token customizado fornecido pelo Canvas
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            // Fallback para login anônimo
            await signInAnonymously(auth);
        }

        // Configura o listener de autenticação
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                currentUserId = user.uid;
                await determineUserRole(user.uid);
                checkAuthAndRedirect();
                
                // Inicializa a UI específica da página
                if (window.location.pathname.endsWith('admin.html') && currentRole === 'admin') {
                    renderPendingSubmissions();
                    renderExistingQuests();
                    document.getElementById('createQuestForm')?.addEventListener('submit', createQuest);
                } else if (window.location.pathname.endsWith('aluno.html') && currentRole === 'student') {
                    renderStudentDashboard();
                    renderQuests();
                    document.getElementById('proof-form')?.addEventListener('submit', submitProof);
                }
            } else {
                currentUserId = null;
                currentRole = null;
                if (!window.location.pathname.endsWith('index.html')) {
                    window.location.href = 'index.html';
                }
            }
        });

    } catch (error) {
        console.error("Erro ao inicializar Firebase:", error);
        showMessage("Erro fatal na inicialização do app.", "error");
    }
}

/**
 * Determina o papel do usuário (admin ou student).
 * Mantida a lógica original para quando a autenticação real funcionar.
 */
async function determineUserRole(uid) {
    const ADMIN_EMAIL_SIMULATION = "admin@fitquest.com"; 

    if (auth.currentUser && auth.currentUser.email === ADMIN_EMAIL_SIMULATION) {
        currentRole = 'admin';
        return;
    }
    
    // Tenta buscar o perfil do usuário
    const profileRef = doc(db, getStudentProfilePath(uid));
    const profileSnap = await getDoc(profileRef);
    
    if (profileSnap.exists() && profileSnap.data().role === 'admin') {
        currentRole = 'admin';
        return;
    }
    
    currentRole = 'student';
}

// --- PATH UTILS (Sem alteração) ---

function getQuestsCollectionPath() {
    return `artifacts/${appId}/public/data/quests`;
}

function getSubmissionsCollectionPath() {
    return `artifacts/${appId}/public/data/submissions`;
}

function getStudentProfilePath(uid) {
    return `artifacts/${appId}/users/${uid}/profile/user_data`;
}

// --- UTILS AND UI (Sem alteração, exceto a correção do elemento de mensagem) ---

function showMessage(message, type) {
    const container = document.getElementById('message-container');
    const errorMessage = document.getElementById('error-message'); // Adicionado ID correto

    if (!container || !errorMessage) return;

    let bgColor, textColor;
    switch (type) {
        case 'success':
            bgColor = 'bg-green-500';
            textColor = 'text-white';
            break;
        case 'error':
            bgColor = 'bg-red-500';
            textColor = 'text-white';
            break;
        case 'info':
        default:
            bgColor = 'bg-indigo-500';
            textColor = 'text-white';
            break;
    }

    // Se estiver usando o modal de notificação (fora do formulário)
    if (container.classList.contains('fixed')) {
        const alert = document.createElement('div');
        alert.className = `fixed top-4 right-4 p-4 rounded-lg shadow-xl font-semibold ${bgColor} ${textColor} z-50 transition-opacity duration-300`;
        alert.textContent = message;
        container.appendChild(alert);

        setTimeout(() => {
            alert.classList.add('opacity-0');
            alert.addEventListener('transitionend', () => alert.remove());
        }, 3000);
    } else {
        // Se estiver usando o container de erro dentro do formulário
        errorMessage.textContent = message;
        container.classList.remove('hidden');
        container.classList.remove('bg-red-100', 'bg-green-100', 'text-red-700', 'text-green-700');
        if (type === 'error') {
            container.classList.add('bg-red-100', 'text-red-700');
        } else if (type === 'success') {
            container.classList.add('bg-green-100', 'text-green-700');
        }
        
        setTimeout(() => {
            container.classList.add('hidden');
        }, 5000);
    }
}

function showConfirmationModal(message) {
    return new Promise(resolve => {
        confirmationResolver = resolve;
        document.getElementById('confirmation-message').textContent = message;
        document.getElementById('confirmation-modal').classList.remove('hidden');
    });
}

function handleConfirm(result) {
    if (confirmationResolver) {
        confirmationResolver(result);
        confirmationResolver = null;
    }
    document.getElementById('confirmation-modal').classList.add('hidden');
}

function checkAuthAndRedirect() {
    const path = window.location.pathname;
    
    if (path.endsWith('index.html') && currentRole) {
        window.location.href = currentRole === 'admin' ? 'admin.html' : 'aluno.html';
        return;
    }

    if (path.endsWith('admin.html') && currentRole !== 'admin') {
        window.location.href = 'aluno.html';
        return;
    }
    if (path.endsWith('aluno.html') && currentRole !== 'student') {
        window.location.href = 'admin.html';
        return;
    }
}

// --- AUTH LOGIC (LOGIN/LOGOUT) ---

/**
 * NOVO: Lógica de login SIMPLIFICADA que APENAS REDIRECIONA para resolver o problema.
 * @param {Event} e 
 */
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const errorMessage = document.getElementById('error-message'); // Corrigi o ID para 'error-message' no showMessage

    // Limpa a mensagem de erro anterior
    if (errorMessage) errorMessage.classList.add('hidden');

    // **SIMULAÇÃO DE LOGIN DIRETO (Solução para o problema de redirecionamento)**
    if (email === 'admin@fitquest.com') {
         // Se for o Admin simulado, redireciona
         showMessage("Login de Admin simulado. Redirecionando...", "info");
         // Uso de um pequeno timeout para a mensagem ser visível antes do redirect
         setTimeout(() => { window.location.href = 'admin.html'; }, 500);
    } else if (email === 'aluno@fitquest.com') {
         // Se for o Aluno simulado, redireciona
         showMessage("Login de Aluno simulado. Redirecionando...", "info");
         setTimeout(() => { window.location.href = 'aluno.html'; }, 500);
    } else {
         // Credenciais de simulação inválidas
         showMessage("Apenas as contas de teste (admin@fitquest.com ou aluno@fitquest.com) são permitidas.", "error");
    }
    // A chamada 'signInWithEmailAndPassword' foi removida intencionalmente.
}

/**
 * Simula o login de um usuário específico (preenche os campos e simula o submit).
 */
function simulateLogin(email, password) {
    document.getElementById('email').value = email;
    document.getElementById('password').value = password;
    // Dispara o evento de submit para usar a mesma lógica do botão 'Entrar'
    document.getElementById('loginForm').dispatchEvent(new Event('submit'));
}

/**
 * Realiza o logout do usuário.
 */
async function handleLogout() {
    await signOut(auth);
    showMessage("Você foi desconectado.", "info");
    window.location.href = 'index.html';
}

// --- STUDENT DASHBOARD LOGIC (aluno.html) --- (Mantida a lógica original)

function calculateLevel(totalXP) {
    const xpPerLevel = 100;
    const level = Math.floor(totalXP / xpPerLevel) + 1;
    const xpInLevel = totalXP % xpPerLevel;
    const xpToNext = xpPerLevel - xpInLevel;
    return { level, xpInLevel, xpToNext, xpPerLevel };
}

async function renderStudentDashboard() {
    if (!currentUserId) return;

    const profileRef = doc(db, getStudentProfilePath(currentUserId));

    onSnapshot(profileRef, async (docSnap) => {
        let profile = { name: "Novo Aluno", totalXP: 0 };
        
        if (!docSnap.exists()) {
            await setDoc(profileRef, profile, { merge: true });
        } else {
            profile = docSnap.data();
        }

        const { level, xpInLevel, xpPerLevel } = calculateLevel(profile.totalXP || 0);

        document.getElementById('student-name').textContent = profile.name;
        document.getElementById('student-level').textContent = `Lvl ${level}`;
        document.getElementById('student-xp').textContent = `${xpInLevel} / ${xpPerLevel} XP`;
        
        const progressPercentage = (xpInLevel / xpPerLevel) * 100;
        const progressBar = document.getElementById('progress-bar');
        progressBar.style.width = `${progressPercentage}%`;
        progressBar.setAttribute('aria-valuenow', progressPercentage);
    });
}

function renderQuests() {
    const questsList = document.getElementById('quests-list');
    const questsRef = collection(db, getQuestsCollectionPath());
    
    onSnapshot(questsRef, (snapshot) => {
        if (!currentUserId) return;

        let html = '';
        if (snapshot.empty) {
            html = '<p class="p-6 bg-yellow-100 rounded-xl text-yellow-800 font-medium">Nenhuma Quest disponível no momento. Fale com seu Admin!</p>';
        } else {
            snapshot.docs.forEach(questDoc => {
                const quest = questDoc.data();
                const questId = questDoc.id;

                html += `
                    <div class="bg-white p-6 rounded-xl shadow-lg border-l-4 border-green-500">
                        <div class="flex justify-between items-start">
                            <h4 class="text-xl font-bold text-gray-800">${quest.name}</h4>
                            <span class="text-sm font-bold bg-green-100 text-green-700 px-3 py-1 rounded-full">+${quest.xp} XP</span>
                        </div>
                        <p class="text-gray-600 mt-2 mb-4">${quest.description}</p>
                        <div class="flex justify-between items-center text-sm">
                            <span class="text-gray-500">Prova: ${quest.validationType}</span>
                            <button 
                                onclick="window.fitquest.openProofModal('${questId}', '${quest.name}', '${quest.validationType}')"
                                class="bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition"
                            >
                                Enviar Prova
                            </button>
                        </div>
                    </div>
                `;
            });
        }
        questsList.innerHTML = html;
    });
}

let activeQuestId = null;
let activeValidationType = null;

function openProofModal(questId, questName, validationType) {
    activeQuestId = questId;
    activeValidationType = validationType;
    
    const modalTitle = document.getElementById('modal-title');
    const proofLabel = document.getElementById('proof-label');
    const proofInput = document.getElementById('proof-input');
    const proofModal = document.getElementById('proof-modal');

    modalTitle.textContent = `Enviar Prova: ${questName}`;
    
    let placeholder = 'Insira o valor da prova aqui...';

    if (validationType === 'QR-Code') {
        proofLabel.textContent = 'Código QR ou Chave de Validação';
        placeholder = 'Ex: 1A2B3C';
    } else if (validationType === 'Foto') {
        proofLabel.textContent = 'URL da Foto ou Vídeo de Prova';
        placeholder = 'Ex: https://link.para/sua/foto.jpg';
    } else if (validationType === 'Manual') {
        proofLabel.textContent = 'Comentário/Nota para o Admin';
        placeholder = 'Ex: Completei 1 hora de yoga hoje.';
    }

    proofInput.setAttribute('placeholder', placeholder);
    proofModal.classList.remove('hidden');
}

function closeProofModal() {
    document.getElementById('proof-modal').classList.add('hidden');
    document.getElementById('proof-form').reset();
    activeQuestId = null;
    activeValidationType = null;
}

async function submitProof(e) {
    e.preventDefault();
    if (!activeQuestId || !currentUserId) return;

    const proofValue = document.getElementById('proof-input').value.trim();
    
    if (!proofValue) {
        showMessage("O valor da prova não pode ser vazio.", "error");
        return;
    }

    try {
        const questRef = doc(db, getQuestsCollectionPath(), activeQuestId);
        const questSnap = await getDoc(questRef);
        
        if (!questSnap.exists()) {
            showMessage("Quest não encontrada. Tente novamente.", "error");
            closeProofModal();
            return;
        }

        const questData = questSnap.data();

        await addDoc(collection(db, getSubmissionsCollectionPath()), {
            questId: activeQuestId,
            questName: questData.name,
            questXP: questData.xp,
            studentId: currentUserId,
            proofValue: proofValue,
            validationType: activeValidationType,
            submittedAt: new Date().toISOString(),
            status: 'pending' // pending, approved, rejected
        });

        showMessage("Prova enviada com sucesso! Aguardando aprovação do Admin.", "success");
        closeProofModal();

    } catch (error) {
        console.error("Erro ao submeter prova:", error);
        showMessage("Erro ao enviar prova. Tente novamente.", "error");
    }
}

// --- ADMIN DASHBOARD LOGIC (admin.html) --- (Mantida a lógica original)

async function createQuest(e) {
    e.preventDefault();
    
    const name = document.getElementById('quest-name').value.trim();
    const description = document.getElementById('quest-description').value.trim();
    const xp = parseInt(document.getElementById('quest-xp').value, 10);
    const validationType = document.getElementById('quest-validation-type').value;

    if (!name || !description || isNaN(xp) || xp <= 0) {
        showMessage("Preencha todos os campos corretamente.", "error");
        return;
    }

    try {
        await addDoc(collection(db, getQuestsCollectionPath()), {
            name,
            description,
            xp,
            validationType,
            createdAt: new Date().toISOString()
        });

        showMessage("Quest criada com sucesso!", "success");
        document.getElementById('createQuestForm').reset();
    } catch (error) {
        console.error("Erro ao criar quest:", error);
        showMessage("Erro ao salvar Quest no banco de dados.", "error");
    }
}

function renderExistingQuests() {
    const listElement = document.getElementById('existing-quests-list');
    const questsRef = collection(db, getQuestsCollectionPath());
    
    onSnapshot(questsRef, (snapshot) => {
        let html = '';
        if (snapshot.empty) {
            html = '<p class="text-gray-500">Nenhuma Quest criada ainda.</p>';
        } else {
            snapshot.docs.forEach(questDoc => {
                const quest = questDoc.data();
                
                html += `
                    <div class="flex justify-between items-center p-3 border-b border-gray-100 last:border-b-0">
                        <div>
                            <p class="font-semibold text-gray-800">${quest.name} (<span class="text-indigo-600">+${quest.xp} XP</span>)</p>
                            <p class="text-xs text-gray-500">${quest.validationType}</p>
                        </div>
                        <button 
                            onclick="window.fitquest.deleteQuest('${questDoc.id}')"
                            class="text-red-500 hover:text-red-700 transition"
                            title="Deletar Quest"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.723-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 10-2 0v6a1 1 0 102 0V8z" clip-rule="evenodd" />
                            </svg>
                        </button>
                    </div>
                `;
            });
        }
        listElement.innerHTML = html;
    });
}

async function deleteQuest(questId) {
    const confirmed = await showConfirmationModal("Tem certeza que deseja deletar esta Quest? Isso é irreversível.");
    if (!confirmed) return;

    try {
        await deleteDoc(doc(db, getQuestsCollectionPath(), questId));
        showMessage("Quest deletada com sucesso.", "success");
    } catch (error) {
        console.error("Erro ao deletar quest:", error);
        showMessage("Erro ao deletar Quest.", "error");
    }
}

function renderPendingSubmissions() {
    const listElement = document.getElementById('pending-submissions-list');
    const submissionsRef = collection(db, getSubmissionsCollectionPath());
    
    const q = query(submissionsRef, where("status", "==", "pending"));

    onSnapshot(q, async (snapshot) => {
        let html = '';
        if (snapshot.empty) {
            html = '<p class="p-6 bg-green-100 rounded-xl text-green-700 font-medium">Nenhuma submissão pendente. Tudo certo! 🎉</p>';
        } else {
            const promises = snapshot.docs.map(async subDoc => {
                const sub = subDoc.data();
                const submissionId = subDoc.id;
                
                let studentDisplayId = sub.studentId.substring(0, 8); 
                
                let proofDisplay;
                if (sub.validationType === 'Foto') {
                    proofDisplay = `<a href="${sub.proofValue}" target="_blank" class="text-indigo-600 hover:underline font-medium break-all">Ver Prova (Link)</a>`;
                } else {
                    proofDisplay = `<span class="font-mono bg-gray-100 p-1 rounded text-sm text-gray-700">${sub.proofValue}</span>`;
                }
                
                return `
                    <div class="bg-white p-5 rounded-xl shadow-lg border-l-4 border-red-500">
                        <div class="flex justify-between items-start mb-2">
                            <h4 class="text-xl font-bold text-gray-800">${sub.questName}</h4>
                            <span class="text-sm font-bold bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full">+${sub.questXP} XP</span>
                        </div>
                        <p class="text-sm text-gray-500 mb-3">Aluno ID: <span class="font-mono text-gray-700">${studentDisplayId}...</p>
                        <p class="text-gray-600 mb-4">Prova: ${proofDisplay}</p>
                        
                        <div class="flex space-x-3">
                            <button 
                                onclick="window.fitquest.approveSubmission('${submissionId}', '${sub.studentId}', ${sub.questXP})"
                                class="flex-1 bg-green-600 text-white py-2 rounded-lg font-semibold text-sm hover:bg-green-700 transition"
                            >
                                Aprovar
                            </button>
                            <button 
                                onclick="window.fitquest.rejectSubmission('${submissionId}')"
                                class="flex-1 bg-red-600 text-white py-2 rounded-lg font-semibold text-sm hover:bg-red-700 transition"
                            >
                                Rejeitar
                            </button>
                        </div>
                    </div>
                `;
            });

            html = (await Promise.all(promises)).join('');
        }
        listElement.innerHTML = html;
    });
}

async function approveSubmission(submissionId, studentId, xp) {
    const confirmed = await showConfirmationModal(`Conceder ${xp} XP ao aluno?`);
    if (!confirmed) return;

    try {
        const studentProfileRef = doc(db, getStudentProfilePath(studentId));
        const submissionRef = doc(db, getSubmissionsCollectionPath(), submissionId);

        const docSnap = await getDoc(studentProfileRef);
        const currentXP = docSnap.exists() ? docSnap.data()?.totalXP || 0 : 0;
        const newXP = currentXP + xp;

        await setDoc(studentProfileRef, { totalXP: newXP }, { merge: true });
        
        await updateDoc(submissionRef, { status: 'approved', approvedAt: new Date().toISOString() });
        
        showMessage(`Submissão aprovada! ${xp} XP concedidos ao aluno.`, "success");
    } catch (error) {
        console.error("Erro ao aprovar submissão:", error);
        showMessage("Erro ao processar aprovação.", "error");
    }
}

async function rejectSubmission(submissionId) {
    const confirmed = await showConfirmationModal("Tem certeza que deseja rejeitar esta submissão?");
    if (!confirmed) return;

    try {
        const submissionRef = doc(db, getSubmissionsCollectionPath(), submissionId);
        
        await updateDoc(submissionRef, { status: 'rejected', rejectedAt: new Date().toISOString() });
        
        showMessage("Submissão rejeitada.", "info");
    } catch (error) {
        console.error("Erro ao rejeitar submissão:", error);
        showMessage("Erro ao processar rejeição.", "error");
    }
}


// --- MAIN EXECUTION AND EXPOSURE ---

// Inicializa o Firebase e o listener de autenticação
initializeFirebase();

// Adiciona event listeners para a página de login, se aplicável
document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.endsWith('index.html')) {
        // Se o elemento existe, adiciona o listener
        document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
        // Correção: Garantir que os IDs dos botões estejam corretos e chamem a função simulateLogin
        document.getElementById('testAluno')?.addEventListener('click', () => simulateLogin('aluno@fitquest.com', '123456'));
        document.getElementById('testAdmin')?.addEventListener('click', () => simulateLogin('admin@fitquest.com', '123456'));
        
        // Listeners para o modal de confirmação
        document.getElementById('confirm-yes')?.addEventListener('click', () => handleConfirm(true));
        document.getElementById('confirm-no')?.addEventListener('click', () => handleConfirm(false));
    }
});

// Expõe funções públicas para acesso via HTML (onclick)
window.fitquest = {
    handleLogout,
    handleConfirm, 
    openProofModal,
    closeProofModal,
    createQuest,
    deleteQuest,
    approveSubmission,
    rejectSubmission
};
