// =====================================================================
// Configuração e Inicialização do Firebase (Modular Imports v11.6.1)
// =====================================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { 
    getAuth, 
    signInWithCustomToken, 
    signInAnonymously, 
    onAuthStateChanged, 
    signInWithEmailAndPassword, 
    signOut 
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc, 
    collection, 
    onSnapshot, 
    query, 
    where, 
    runTransaction, 
    updateDoc, 
    deleteDoc, 
    serverTimestamp,
    setLogLevel 
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

// --- Variáveis Globais (Fornecidas pelo ambiente Canvas) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'fitquest-default-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Instâncias
let app, auth, db, userId = null;
let isAuthReady = false;

// Variável para callback de confirmação global
let confirmActionCallback = null;

/**
 * Inicializa o app e serviços Firebase.
 * @returns {boolean} Sucesso da inicialização.
 */
function initializeFirebase() {
    if (!firebaseConfig) {
        console.error("Firebase Configuração ausente. O app não pode iniciar.");
        return false;
    }
    
    // Evita reinicialização
    if (app) return true; 

    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        
        // Configura o nível de log para debug
        setLogLevel('debug'); 
        return true;
    } catch (error) {
        console.error("Erro ao inicializar Firebase:", error);
        return false;
    }
}

// =====================================================================
// Lógica do Jogo (Gamificação)
// =====================================================================

// Curva de XP (Base para a lógica de Níveis)
const XP_CURVE = [
    { level: 1, name: "Frango", requiredXP: 0 },
    { level: 2, name: "Iniciante", requiredXP: 100 },
    { level: 3, name: "Praticante", requiredXP: 400 },
    { level: 4, name: "Fitness", requiredXP: 900 },
    { level: 5, name: "Elite", requiredXP: 1700 },
];

/**
 * Calcula o nível e o progresso do aluno com base no XP total.
 * @param {number} currentXP - XP total do aluno.
 * @returns {{level: number, name: string, progress: number, xpToNext: number, xpRequired: number}}
 */
function calculateLevel(currentXP) {
    let currentLevel = XP_CURVE[0];
    let nextLevel = null;

    for (let i = 0; i < XP_CURVE.length; i++) {
        if (currentXP >= XP_CURVE[i].requiredXP) {
            currentLevel = XP_CURVE[i];
            nextLevel = XP_CURVE[i + 1];
        } else {
            break;
        }
    }

    if (!nextLevel) {
        return {
            level: currentLevel.level,
            name: currentLevel.name,
            progress: 100, 
            xpToNext: 0,
            xpRequired: currentLevel.requiredXP
        };
    }

    const xpForCurrentLevel = currentLevel.requiredXP;
    const xpNeededForNext = nextLevel.requiredXP - xpForCurrentLevel;
    const xpEarnedInCurrentLevel = currentXP - xpForCurrentLevel;
    
    const progressPercent = Math.min(100, (xpEarnedInCurrentLevel / xpNeededForNext) * 100);

    return {
        level: currentLevel.level,
        name: currentLevel.name,
        progress: progressPercent,
        xpToNext: nextLevel.requiredXP - currentXP,
        xpRequired: nextLevel.requiredXP,
        xpCurrentLevel: xpEarnedInCurrentLevel
    };
}


// =====================================================================
// Funções de Utilidade (UI/Mensagens/Confirmação)
// =====================================================================

/**
 * Exibe uma mensagem de notificação (substitui o alert()).
 * @param {string} message - A mensagem a ser exibida.
 * @param {string} type - 'success', 'error', 'info'.
 */
function showMessage(message, type = 'info') {
    const container = document.getElementById('message-container');
    if (!container) return;

    const colorClasses = {
        'success': 'bg-green-100 border-green-400 text-green-700',
        'error': 'bg-red-100 border-red-400 text-red-700',
        'info': 'bg-blue-100 border-blue-400 text-blue-700',
    };

    const alertDiv = document.createElement('div');
    alertDiv.className = `fixed top-4 right-4 p-4 border rounded-lg shadow-lg z-50 transition-transform transform translate-x-0 ${colorClasses[type]}`;
    alertDiv.textContent = message;

    container.appendChild(alertDiv);

    // Remove a mensagem após 5 segundos
    setTimeout(() => {
        alertDiv.classList.add('translate-x-full');
        alertDiv.addEventListener('transitionend', () => alertDiv.remove());
    }, 5000);
}

/**
 * Exibe um modal de confirmação customizado (substitui o confirm()).
 * @param {string} message - A mensagem de confirmação.
 * @param {function} callback - A função a ser executada com o resultado (true/false).
 */
function showConfirmModal(message, callback) {
    const modal = document.getElementById('confirmation-modal');
    const messageEl = document.getElementById('confirmation-message');
    if (!modal || !messageEl) {
        console.error("Confirmation modal UI elements missing. Defaulting to confirm=true.");
        callback(true);
        return;
    }

    messageEl.textContent = message;
    modal.classList.remove('hidden');

    confirmActionCallback = callback;
}

/**
 * Lida com o clique nos botões Sim/Não do modal de confirmação.
 * @param {boolean} confirmed - True se 'Sim', False se 'Não'.
 */
function handleConfirm(confirmed) {
    const modal = document.getElementById('confirmation-modal');
    if (modal) modal.classList.add('hidden');

    if (confirmActionCallback) {
        confirmActionCallback(confirmed);
    }
    confirmActionCallback = null;
}

// =====================================================================
// Funções de Autenticação e Roteamento
// =====================================================================

/**
 * Função para criar ou atualizar o perfil do usuário no Firestore.
 */
async function setupUserProfile(user, role) {
    const userDocRef = doc(db, 'alunos', user.uid);
    const userDoc = await getDoc(userDocRef);
    
    const userData = {
        nome: user.email ? user.email.split('@')[0] : `Aluno_${user.uid.substring(0, 4)}`,
        email: user.email || 'anonimo@fitquest.com',
        XP: 0,
        role: role,
        createdAt: serverTimestamp()
    };

    if (!userDoc.exists()) {
        await setDoc(userDocRef, userData);
        showMessage(`Bem-vindo, ${role}! Seu perfil foi criado.`, 'success');
    } else if (userDoc.data().role !== role) {
         await updateDoc(userDocRef, { role: role });
         showMessage(`Papel de usuário atualizado para ${role}!`, 'info');
    }
}

/**
 * Manipula o Login (e-mail/senha) e redireciona.
 */
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');
    errorMessage.classList.add('hidden');

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const uid = userCredential.user.uid;
        
        const userDoc = await getDoc(doc(db, 'alunos', uid));
        const userData = userDoc.data();

        if (userData?.role === 'admin') {
            window.location.href = 'admin.html';
        } else {
            window.location.href = 'aluno.html';
        }

    } catch (error) {
        console.error("Erro de Login:", error);
        errorMessage.textContent = `Erro: ${error.message}`;
        errorMessage.classList.remove('hidden');
    }
}

/**
 * Manipula o Logout.
 */
function handleLogout() {
    signOut(auth).then(() => {
        showMessage('Você saiu com sucesso.', 'info');
        window.location.href = 'index.html';
    }).catch((error) => {
        console.error("Erro ao sair:", error);
        showMessage('Erro ao tentar sair.', 'error');
    });
}

/**
 * Configura o login inicial (token ou anônimo).
 */
async function setupInitialAuth() {
    if (!initializeFirebase()) return;

    if (initialAuthToken) {
        try {
            await signInWithCustomToken(auth, initialAuthToken);
        } catch (error) {
            console.error("Erro ao logar com token customizado:", error);
            await signInAnonymously(auth);
        }
    } else {
        if (!auth.currentUser) {
            await signInAnonymously(auth);
        }
    }
}

/**
 * Verifica o estado de autenticação e redireciona ou configura o dashboard.
 */
function checkAuthAndRedirect() {
    if (!initializeFirebase()) return;
    
    // Ouve as mudanças de estado de autenticação
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            // Se não está logado, garante que está na tela de login
            if (document.title.includes('Dashboard Aluno') || document.title.includes('Painel Admin')) {
                window.location.href = 'index.html';
            }
            return;
        }

        userId = user.uid;
        isAuthReady = true;

        // Recupera o perfil do usuário
        const userDoc = await getDoc(doc(db, 'alunos', userId));
        const userData = userDoc.data();
        const currentPath = window.location.pathname;
        const isAdmin = userData?.role === 'admin';
        
        // Redirecionamento forçado para a página correta
        if (isAdmin && !currentPath.includes('admin.html')) {
            window.location.href = 'admin.html';
            return;
        }
        if (!isAdmin && !currentPath.includes('aluno.html') && !currentPath.includes('index.html')) {
            window.location.href = 'aluno.html';
            return;
        }

        // Se o usuário está na página correta, carrega o dashboard
        if (currentPath.includes('admin.html') && isAdmin) {
            renderAdminDashboard();
        } else if (currentPath.includes('aluno.html') && !isAdmin) {
            renderStudentDashboard();
        }
    });
}

/**
 * Simula o login como aluno e cria o perfil se necessário.
 */
async function simulateStudentLogin() {
    await setupInitialAuth();
    if (!auth.currentUser) return;
    
    await setupUserProfile(auth.currentUser, 'aluno');
    window.location.href = 'aluno.html';
}

/**
 * Simula o login como admin e cria o perfil se necessário.
 */
async function simulateAdminLogin() {
    await setupInitialAuth();
    if (!auth.currentUser) return;
    
    await setupUserProfile(auth.currentUser, 'admin');
    window.location.href = 'admin.html';
}

// =====================================================================
// Funções do Aluno (aluno.html)
// =====================================================================

let currentQuestForSubmission = null;

function renderStudentDashboard() {
    if (!db || !userId) return;

    onSnapshot(doc(db, 'alunos', userId), docSnapshot => {
        if (!docSnapshot.exists()) return;
        const userData = docSnapshot.data();
        const studentXP = userData.XP || 0;
        
        const { level, name, progress, xpToNext, xpRequired } = calculateLevel(studentXP);
        
        document.getElementById('student-name').textContent = `Olá, ${userData.nome}!`;
        document.getElementById('student-level').textContent = name;
        document.getElementById('student-xp').textContent = `${studentXP} / ${xpRequired} XP`;
        
        const progressBar = document.getElementById('progress-bar');
        if(progressBar) progressBar.style.width = `${progress}%`;
        
        renderQuests(userId);
    });
}

function renderQuests(currentUserId) {
    if (!db) return;

    const questsListEl = document.getElementById('quests-list');
    if (questsListEl) questsListEl.innerHTML = '<p class="p-4 bg-blue-100 rounded-lg text-blue-800">Buscando Quests...</p>';

    onSnapshot(collection(db, 'public', appId, 'data', 'quests', 'list'), questsSnapshot => {
        
        onSnapshot(collection(db, 'alunos', currentUserId, 'submissoes'), submissionsSnapshot => {
            
            const submissions = {};
            submissionsSnapshot.forEach(doc => {
                const data = doc.data();
                submissions[data.questId] = data.status;
            });

            if (questsListEl) questsListEl.innerHTML = '';

            if (questsSnapshot.empty) {
                if (questsListEl) questsListEl.innerHTML = '<p class="p-4 bg-gray-200 rounded-lg text-gray-700">Nenhuma Quest ativa no momento.</p>';
                return;
            }

            questsSnapshot.forEach(doc => {
                const quest = doc.data();
                const questId = doc.id;
                const status = submissions[questId] || 'pendente_aluno'; 
                
                let buttonHtml = '';
                let statusText = '';
                let statusColor = '';
                
                if (status === 'aprovado') {
                    statusText = '✅ COMPLETA!';
                    statusColor = 'bg-green-100 border-green-500';
                    buttonHtml = '<button disabled class="px-4 py-2 bg-gray-400 text-white rounded-lg opacity-50 cursor-not-allowed">Concluída</button>';
                } else if (status === 'pendente_admin') {
                    statusText = '⏳ AGUARDANDO APROVAÇÃO';
                    statusColor = 'bg-yellow-100 border-yellow-500';
                    buttonHtml = '<button disabled class="px-4 py-2 bg-yellow-500 text-white rounded-lg opacity-75 cursor-not-allowed">Em Revisão</button>';
                } else if (status === 'rejeitado') {
                    statusText = '❌ REJEITADA. Envie Novamente.';
                    statusColor = 'bg-red-100 border-red-500';
                    buttonHtml = `<button onclick="window.fitquest.showProofModal('${questId}', '${quest.validationType}')" class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition">Enviar Prova</button>`;
                } else { // pendente_aluno
                     statusText = `⭐ ${quest.XP} XP de Recompensa`;
                     statusColor = 'bg-white border-gray-300';
                     buttonHtml = `<button onclick="window.fitquest.showProofModal('${questId}', '${quest.validationType}')" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">Concluir e Enviar Prova</button>`;
                }

                const questCard = `
                    <div class="p-5 border-l-4 ${statusColor} rounded-xl shadow-md flex justify-between items-center transition hover:shadow-lg">
                        <div class="flex-1">
                            <h4 class="text-lg font-bold text-gray-800">${quest.name}</h4>
                            <p class="text-sm text-gray-600 mb-2">${quest.description}</p>
                            <span class="text-xs font-semibold ${status === 'aprovado' ? 'text-green-700' : status === 'pendente_admin' ? 'text-yellow-700' : 'text-gray-500'}">${statusText}</span>
                        </div>
                        <div>
                           ${buttonHtml}
                        </div>
                    </div>
                `;
                if (questsListEl) questsListEl.innerHTML += questCard;
            });
        });
    });
}

function showProofModal(questId, validationType) {
    currentQuestForSubmission = { questId, validationType };
    
    const modal = document.getElementById('proof-modal');
    const title = document.getElementById('modal-title');
    const label = document.getElementById('proof-label');
    const input = document.getElementById('proof-input');

    if (modal) modal.classList.remove('hidden');
    if (title) title.textContent = "Enviar Prova";
    if (input) input.type = 'text'; 
    
    if (validationType === 'QR-Code') {
        if (label) label.textContent = "Código QR da Recepção:";
        if (input) input.placeholder = "Insira o código de validação...";
    } else if (validationType === 'Foto') {
        if (label) label.textContent = "URL da Foto/Vídeo (Painel da Esteira, etc.):";
        if (input) input.placeholder = "Ex: https://i.imgur.com/minha-foto.jpg";
    } else { // Manual
        if (label) label.textContent = "Observações para o Admin (Opcional):";
        if (input) input.placeholder = "Mensagem para o Ricardo...";
    }
}

function closeProofModal() {
    const modal = document.getElementById('proof-modal');
    const form = document.getElementById('proof-form');
    if (modal) modal.classList.add('hidden');
    if (form) form.reset();
    currentQuestForSubmission = null;
}

async function handleProofSubmission(e) {
    e.preventDefault();
    if (!userId || !currentQuestForSubmission) return;

    const proofInput = document.getElementById('proof-input');
    const proofValue = proofInput ? proofInput.value : '';
    const { questId, validationType } = currentQuestForSubmission;

    const submissionData = {
        alunoId: userId,
        questId: questId,
        proofValue: proofValue,
        proofType: validationType,
        status: 'pendente_admin', 
        submittedAt: serverTimestamp()
    };

    try {
        const studentSubmissionsRef = collection(db, 'alunos', userId, 'submissoes');
        
        const q = query(studentSubmissionsRef, where('questId', '==', questId));
        const existingSubmissionQuery = await getDocs(q);

        if (!existingSubmissionQuery.empty) {
            const docRef = existingSubmissionQuery.docs[0].ref;
            await updateDoc(docRef, submissionData);
        } else {
            await setDoc(doc(studentSubmissionsRef), submissionData);
        }
        
        showMessage('Prova enviada com sucesso! Aguarde a aprovação do Ricardo.', 'success');
        closeProofModal();
    } catch (error) {
        console.error("Erro ao enviar prova:", error);
        showMessage('Erro ao enviar prova. Tente novamente.', 'error');
    }
}


// =====================================================================
// Funções do Admin (admin.html)
// =====================================================================

let allQuestsData = {};

function renderAdminDashboard() {
    if (!db) return;

    onSnapshot(collection(db, 'public', appId, 'data', 'quests', 'list'), snapshot => {
        allQuestsData = {};
        snapshot.forEach(doc => {
            allQuestsData[doc.id] = doc.data();
        });
        renderQuestsList(); 
        renderSubmissions();
    });
}

function renderQuestsList() {
    const listEl = document.getElementById('existing-quests-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    
    if (Object.keys(allQuestsData).length === 0) {
        listEl.innerHTML = '<p class="text-gray-500">Nenhuma Quest foi criada ainda.</p>';
        return;
    }
    
    Object.keys(allQuestsData).forEach(id => {
        const quest = allQuestsData[id];
        const item = document.createElement('div');
        item.className = 'p-3 border-b border-gray-100 flex justify-between items-center';
        item.innerHTML = `
            <div>
                <p class="font-semibold text-gray-800">${quest.name} (${quest.XP} XP)</p>
                <p class="text-xs text-gray-500">Validação: ${quest.validationType} | ${quest.description.substring(0, 40)}...</p>
            </div>
            <button onclick="window.fitquest.deleteQuest('${id}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button>
        `;
        listEl.appendChild(item);
    });
}

async function deleteQuest(questId) {
    // Substituindo o confirm() nativo por um modal customizado
     showConfirmModal(`Tem certeza que deseja excluir a Quest "${allQuestsData[questId].name}"?`, async (confirmed) => {
        if (!confirmed) return;

        try {
            await deleteDoc(doc(db, 'public', appId, 'data', 'quests', 'list', questId));
            showMessage('Quest excluída com sucesso!', 'success');
        } catch (error) {
            console.error("Erro ao excluir Quest:", error);
            showMessage('Erro ao excluir Quest.', 'error');
        }
    });
}

function renderSubmissions() {
    const listEl = document.getElementById('pending-submissions-list');
    if (!listEl) return;
    listEl.innerHTML = ''; 

    getDocs(collection(db, 'alunos')).then(alunosSnapshot => {
        if (alunosSnapshot.empty) {
            listEl.innerHTML = '<p class="p-4 bg-gray-200 rounded-lg text-gray-700">Nenhum aluno cadastrado para verificar submissões.</p>';
            return;
        }

        let pendingCount = 0;
        listEl.innerHTML = ''; 

        alunosSnapshot.forEach(alunoDoc => {
            const alunoId = alunoDoc.id;
            const alunoData = alunoDoc.data();
            const alunoNome = alunoData.nome || (alunoData.email ? alunoData.email.split('@')[0] : 'Nome Indisponível');

            onSnapshot(query(collection(db, 'alunos', alunoId, 'submissoes'), where('status', '==', 'pendente_admin')), submissionsSnapshot => {
                
                // Clear and re-render only the submissions for this specific student to avoid duplication
                const existingItems = Array.from(listEl.children);
                existingItems.filter(item => item.dataset.alunoid === alunoId).forEach(item => item.remove());

                submissionsSnapshot.forEach(subDoc => {
                    const submission = subDoc.data();
                    const submissionId = subDoc.id;
                    const questInfo = allQuestsData[submission.questId] || { name: 'Quest Desconhecida', XP: '??' };
                    
                    pendingCount++;

                    const item = document.createElement('div');
                    item.className = 'bg-white p-4 rounded-xl shadow-lg border-l-4 border-yellow-500 space-y-2';
                    item.dataset.alunoid = alunoId; // Marca para limpeza
                    item.innerHTML = `
                        <p class="font-bold text-lg text-gray-800">${questInfo.name} <span class="text-sm font-normal text-gray-500">(${questInfo.XP} XP)</span></p>
                        <p class="text-sm text-gray-600">Aluno: ${alunoNome}</p>
                        <p class="text-sm text-gray-600">Prova (${submission.proofType}): <span class="font-semibold text-indigo-600 break-all">${submission.proofValue}</span></p>
                        <div class="flex space-x-3 pt-2">
                            <button onclick="window.fitquest.handleApproveSubmission('${alunoId}', '${submissionId}', ${questInfo.XP})" class="flex-1 bg-green-500 text-white py-2 rounded-lg text-sm font-semibold hover:bg-green-600 transition">Aprovar XP</button>
                            <button onclick="window.fitquest.handleRejectSubmission('${alunoId}', '${submissionId}')" class="flex-1 bg-red-500 text-white py-2 rounded-lg text-sm font-semibold hover:bg-red-600 transition">Rejeitar</button>
                        </div>
                    `;
                    listEl.appendChild(item);
                });

                // Esta lógica de contagem é um pouco complexa devido ao onSnapshot aninhado.
                // A maneira mais simples de garantir a mensagem 'Nenhuma submissão pendente'
                // é verificar se a lista está vazia após o processamento de TODOS os alunos.
                // Aqui, apenas garantimos que a submissão pendente está sendo renderizada.
                // A mensagem 'Nenhuma submissão pendente' será tratada de forma simples no final se a lista estiver vazia.
            });
        });

        // Este timeout é um hack para dar tempo ao onSnapshot aninhado
        // de preencher a lista antes de verificar se está vazia.
        setTimeout(() => {
             if (listEl.children.length === 0) {
                 listEl.innerHTML = '<p class="p-4 bg-green-100 rounded-lg text-green-700">🎉 Nenhuma submissão pendente de aprovação!</p>';
             }
        }, 500);
    });
}

async function handleCreateQuest(e) {
    e.preventDefault();
    
    const name = document.getElementById('quest-name').value;
    const description = document.getElementById('quest-description').value;
    const xp = parseInt(document.getElementById('quest-xp').value, 10);
    const validationType = document.getElementById('quest-validation-type').value;

    const newQuest = {
        name,
        description,
        XP: xp,
        validationType,
        createdAt: serverTimestamp()
    };

    try {
        await setDoc(doc(collection(db, 'public', appId, 'data', 'quests', 'list')), newQuest);
        
        showMessage(`Quest "${name}" criada com sucesso!`, 'success');
        document.getElementById('createQuestForm').reset();
    } catch (error) {
        console.error("Erro ao criar Quest:", error);
        showMessage('Erro ao criar Quest. Verifique as permissões.', 'error');
    }
}

async function handleApproveSubmission(alunoId, submissionId, rewardXP) {
    const submissionRef = doc(db, 'alunos', alunoId, 'submissoes', submissionId);
    
    await updateDoc(submissionRef, { 
        status: 'aprovado',
        approvedAt: serverTimestamp()
    });

    const alunoRef = doc(db, 'alunos', alunoId);
    try {
        await runTransaction(db, async (transaction) => {
            const alunoDoc = await transaction.get(alunoRef);
            if (!alunoDoc.exists()) {
                throw "Aluno não existe!";
            }
            const newXP = (alunoDoc.data().XP || 0) + rewardXP;
            transaction.update(alunoRef, { XP: newXP });
        });
        showMessage(`Submissão aprovada! ${rewardXP} XP adicionado ao aluno!`, 'success');
    } catch (error) {
        console.error("Erro na transação de XP:", error);
        showMessage(`Submissão aprovada, mas houve erro ao conceder XP.`, 'error');
    }
}

async function handleRejectSubmission(alunoId, submissionId) {
    const submissionRef = doc(db, 'alunos', alunoId, 'submissoes', submissionId);
    
    try {
        await updateDoc(submissionRef, { 
            status: 'rejeitado',
            rejectedAt: serverTimestamp()
        });
        showMessage('Submissão rejeitada. O aluno pode tentar novamente.', 'info');
    } catch (error) {
        console.error("Erro ao rejeitar submissão:", error);
        showMessage('Erro ao rejeitar submissão.', 'error');
    }
}


// =====================================================================
// Inicialização e Listeners Globais
// =====================================================================

// Expor funções necessárias para uso no onclick (aluno.html e admin.html)
window.fitquest = {
    showProofModal,
    closeProofModal,
    handleLogout,
    deleteQuest,
    handleApproveSubmission,
    handleRejectSubmission,
    // Novas funções de confirmação
    handleConfirm
};

// Adicionar listeners APENAS quando o DOM estiver carregado (padrão de módulo)
document.addEventListener('DOMContentLoaded', () => {
    // 1. Listeners de Login (index.html)
    if (document.getElementById('loginForm')) {
        document.getElementById('loginForm').addEventListener('submit', handleLogin);
        document.getElementById('simulateStudentLogin').addEventListener('click', simulateStudentLogin);
        document.getElementById('simulateAdminLogin').addEventListener('click', simulateAdminLogin);
    }
    
    // 2. Listeners de Dashboards (admin.html e aluno.html)
    if (document.title.includes('Dashboard Aluno') || document.title.includes('Painel Admin')) {
        // Inicia a verificação de autenticação e o carregamento do dashboard
        checkAuthAndRedirect();
    }

    // 3. Listener de Criação de Quest (admin.html)
    if (document.getElementById('createQuestForm')) {
        document.getElementById('createQuestForm').addEventListener('submit', handleCreateQuest);
    }

    // 4. Listener de Envio de Prova (aluno.html)
    if (document.getElementById('proof-form')) {
        document.getElementById('proof-form').addEventListener('submit', handleProofSubmission);
    }
});
