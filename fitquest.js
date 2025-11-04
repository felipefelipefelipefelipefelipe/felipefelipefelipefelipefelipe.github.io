// =====================================================================
// Configuração e Inicialização do Firebase
// =====================================================================

// --- Variáveis Globais (Fornecidas pelo ambiente Canvas) ---
// Em um ambiente de desenvolvimento local, substitua estas linhas pela sua configuração real.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'fitquest-default-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Inicialização
let app, auth, db, userId = null;
let isAuthReady = false;

// Inicializa o app Firebase (chamado no setupInitialAuth)
function initializeFirebase() {
    if (!firebaseConfig) {
        console.error("Firebase Configuração ausente. O app não pode iniciar.");
        return null;
    }
    app = firebase.initializeApp(firebaseConfig);
    auth = app.auth();
    db = app.firestore();
    
    // Configura o nível de log para debug
    firebase.firestore.setLogLevel('debug'); 
    return true;
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
    // Adicione mais níveis aqui!
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
        // Nível Máximo atingido
        return {
            level: currentLevel.level,
            name: currentLevel.name,
            progress: 100, // 100% no nível máximo
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
// Funções de Utilidade (UI/Mensagens)
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

// =====================================================================
// Funções de Autenticação e Roteamento
// =====================================================================

/**
 * Função para criar ou atualizar o perfil do usuário no Firestore.
 * Garante que o usuário (aluno) tenha o campo 'role' e 'XP'.
 * @param {firebase.User} user - Objeto de usuário autenticado.
 * @param {string} role - 'admin' ou 'aluno'.
 */
async function setupUserProfile(user, role) {
    const userDocRef = db.collection('alunos').doc(user.uid);
    const doc = await userDocRef.get();
    
    if (!doc.exists) {
        // Cria um novo perfil se não existir
        await userDocRef.set({
            nome: user.email ? user.email.split('@')[0] : 'Novo Aluno',
            email: user.email || 'anonimo@fitquest.com',
            XP: 0,
            role: role,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showMessage(`Bem-vindo, ${role}! Seu perfil foi criado.`, 'success');
    } else if (doc.data().role !== role) {
         // Se o login de simulação muda o papel, atualiza
         await userDocRef.update({ role: role });
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
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        const uid = userCredential.user.uid;
        
        // Verifica a função do usuário no Firestore
        const userDoc = await db.collection('alunos').doc(uid).get();
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
    auth.signOut().then(() => {
        showMessage('Você saiu com sucesso.', 'info');
        window.location.href = 'index.html';
    }).catch((error) => {
        console.error("Erro ao sair:", error);
        showMessage('Erro ao tentar sair.', 'error');
    });
}

/**
 * Verifica o estado de autenticação e redireciona ou configura o dashboard.
 */
function checkAuthAndRedirect() {
    if (!initializeFirebase()) return;
    
    // Ouve as mudanças de estado de autenticação
    auth.onAuthStateChanged(async (user) => {
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
        const userDoc = await db.collection('alunos').doc(userId).get();
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
 * Configura o login inicial no Canvas (usando token ou anônimo).
 */
async function setupInitialAuth() {
    if (!initializeFirebase()) return;

    if (initialAuthToken) {
        // Tenta login com o token de autenticação fornecido pelo ambiente
        try {
            await auth.signInWithCustomToken(initialAuthToken);
        } catch (error) {
            console.error("Erro ao logar com token customizado:", error);
            // Se falhar, tenta anônimo
            await auth.signInAnonymously();
        }
    } else {
        // Se não há token, tenta login anônimo
        if (!auth.currentUser) {
            await auth.signInAnonymously();
        }
    }
}


// =====================================================================
// Funções do Aluno (aluno.html)
// =====================================================================

// Estado de rastreamento da quest selecionada para submissão
let currentQuestForSubmission = null;

/**
 * Renderiza o dashboard do aluno (XP, Nível e Quests).
 */
function renderStudentDashboard() {
    if (!db || !userId) return;

    // --- 1. Escuta do Perfil do Aluno (XP e Nível) ---
    db.collection('alunos').doc(userId).onSnapshot(doc => {
        if (!doc.exists) return;
        const userData = doc.data();
        const studentXP = userData.XP || 0;
        
        const { level, name, progress, xpToNext, xpRequired } = calculateLevel(studentXP);
        
        // Atualiza UI do progresso
        document.getElementById('student-name').textContent = `Olá, ${userData.nome}!`;
        document.getElementById('student-level').textContent = name;
        document.getElementById('student-xp').textContent = `${studentXP} / ${xpRequired} XP`;
        
        const progressBar = document.getElementById('progress-bar');
        progressBar.style.width = `${progress}%`;
        
        // Atualiza a lista de Quests
        renderQuests(userId);
    });
}

/**
 * Renderiza a lista de Quests ativas e o status de submissão do aluno.
 * @param {string} currentUserId - ID do aluno logado.
 */
function renderQuests(currentUserId) {
    if (!db) return;

    const questsListEl = document.getElementById('quests-list');
    questsListEl.innerHTML = '<p class="p-4 bg-blue-100 rounded-lg text-blue-800">Buscando Quests...</p>';

    // Escuta em tempo real as Quests e Submissões
    db.collection('public').doc(appId).collection('data').doc('quests').collection('list').onSnapshot(questsSnapshot => {
        
        db.collection('alunos').doc(currentUserId).collection('submissoes').onSnapshot(submissionsSnapshot => {
            
            const submissions = {};
            submissionsSnapshot.forEach(doc => {
                const data = doc.data();
                // Usa o ID da Quest como chave para checar o status rapidamente
                submissions[data.questId] = data.status;
            });

            questsListEl.innerHTML = '';

            if (questsSnapshot.empty) {
                questsListEl.innerHTML = '<p class="p-4 bg-gray-200 rounded-lg text-gray-700">Nenhuma Quest ativa no momento.</p>';
                return;
            }

            questsSnapshot.forEach(doc => {
                const quest = doc.data();
                const questId = doc.id;
                const status = submissions[questId] || 'pendente_aluno'; // Status inicial
                
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
                    buttonHtml = `<button onclick="showProofModal('${questId}', '${quest.validationType}')" class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition">Enviar Prova</button>`;
                } else { // pendente_aluno
                     statusText = `⭐ ${quest.XP} XP de Recompensa`;
                     statusColor = 'bg-white border-gray-300';
                     buttonHtml = `<button onclick="showProofModal('${questId}', '${quest.validationType}')" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition">Concluir e Enviar Prova</button>`;
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
                questsListEl.innerHTML += questCard;
            });
        });
    });
}

/**
 * Exibe o modal para o aluno enviar a prova da Quest.
 * @param {string} questId - ID da Quest.
 * @param {string} validationType - Tipo de validação ('QR-Code', 'Foto', 'Manual').
 */
function showProofModal(questId, validationType) {
    currentQuestForSubmission = { questId, validationType };
    
    const modal = document.getElementById('proof-modal');
    const title = document.getElementById('modal-title');
    const label = document.getElementById('proof-label');
    const input = document.getElementById('proof-input');

    title.textContent = "Enviar Prova";
    input.type = 'text'; // Tipo padrão
    
    if (validationType === 'QR-Code') {
        label.textContent = "Código QR da Recepção:";
        input.placeholder = "Insira o código de validação...";
    } else if (validationType === 'Foto') {
        label.textContent = "URL da Foto/Vídeo (Painel da Esteira, etc.):";
        input.placeholder = "Ex: https://i.imgur.com/minha-foto.jpg";
    } else { // Manual
        label.textContent = "Observações para o Admin (Opcional):";
        input.placeholder = "Mensagem para o Ricardo...";
    }

    modal.classList.remove('hidden');
}

/**
 * Fecha o modal de prova.
 */
function closeProofModal() {
    document.getElementById('proof-modal').classList.add('hidden');
    document.getElementById('proof-form').reset();
    currentQuestForSubmission = null;
}

/**
 * Manipula o envio do formulário de prova.
 */
async function handleProofSubmission(e) {
    e.preventDefault();
    if (!userId || !currentQuestForSubmission) return;

    const proofValue = document.getElementById('proof-input').value;
    const { questId, validationType } = currentQuestForSubmission;

    const submissionData = {
        alunoId: userId,
        questId: questId,
        proofValue: proofValue,
        proofType: validationType,
        status: 'pendente_admin', // Manda para aprovação do Admin
        submittedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        const studentSubmissionsRef = db.collection('alunos').doc(userId).collection('submissoes');
        
        // Tenta encontrar uma submissão existente para esta quest (para atualizar o status, se for rejeitada)
        const existingSubmissionQuery = await studentSubmissionsRef.where('questId', '==', questId).get();

        if (!existingSubmissionQuery.empty) {
            // Atualiza a submissão existente
            const docRef = existingSubmissionQuery.docs[0].ref;
            await docRef.update(submissionData);
        } else {
            // Cria uma nova submissão
            await studentSubmissionsRef.add(submissionData);
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

// Dados de todas as quests para fácil referência
let allQuestsData = {};

/**
 * Renderiza o dashboard do administrador.
 */
function renderAdminDashboard() {
    if (!db) return;

    // --- 1. Escuta em tempo real das Quests Criadas ---
    db.collection('public').doc(appId).collection('data').doc('quests').collection('list').onSnapshot(snapshot => {
        allQuestsData = {};
        snapshot.forEach(doc => {
            allQuestsData[doc.id] = doc.data();
        });
        renderQuestsList(); // Renderiza a lista de quests
    });

    // --- 2. Escuta em tempo real de TODAS as Submissões Pendentes ---
    // Isto é mais complexo, pois precisamos ouvir em subcoleções.
    // Vamos usar uma query simples para o MVP: procurar todas as submissões 'pendente_admin'.
    renderSubmissions();
}

/**
 * Renderiza a lista de Quests criadas pelo Admin.
 */
function renderQuestsList() {
    const listEl = document.getElementById('existing-quests-list');
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
            <button onclick="deleteQuest('${id}')" class="text-red-500 hover:text-red-700 text-sm">Excluir</button>
        `;
        listEl.appendChild(item);
    });
}

/**
 * Deleta uma Quest (Exclusão por ID)
 * @param {string} questId - ID da quest a ser deletada.
 */
async function deleteQuest(questId) {
     if (!confirm(`Tem certeza que deseja excluir a Quest "${allQuestsData[questId].name}"?`)) return;

    try {
        await db.collection('public').doc(appId).collection('data').doc('quests').collection('list').doc(questId).delete();
        showMessage('Quest excluída com sucesso!', 'success');
    } catch (error) {
        console.error("Erro ao excluir Quest:", error);
        showMessage('Erro ao excluir Quest.', 'error');
    }
}

/**
 * Renderiza todas as submissões que precisam de aprovação.
 */
function renderSubmissions() {
    const listEl = document.getElementById('pending-submissions-list');
    listEl.innerHTML = ''; // Limpa a lista antes de carregar

    // Para o MVP, faremos uma consulta complexa para todas as submissões de TODOS os alunos
    // Para simplificar no contexto do Canvas, usaremos uma query para documentos de 'alunos' e depois a subcoleção.
    db.collection('alunos').get().then(alunosSnapshot => {
        if (alunosSnapshot.empty) {
            listEl.innerHTML = '<p class="p-4 bg-gray-200 rounded-lg text-gray-700">Nenhum aluno cadastrado para verificar submissões.</p>';
            return;
        }

        let pendingCount = 0;
        listEl.innerHTML = ''; // Limpa para preencher

        alunosSnapshot.forEach(alunoDoc => {
            const alunoId = alunoDoc.id;
            const alunoData = alunoDoc.data();
            const alunoNome = alunoData.nome || alunoData.email.split('@')[0];

            // Escuta as submissões pendentes de CADA aluno
            db.collection('alunos').doc(alunoId).collection('submissoes').where('status', '==', 'pendente_admin').onSnapshot(submissionsSnapshot => {
                
                submissionsSnapshot.forEach(subDoc => {
                    const submission = subDoc.data();
                    const submissionId = subDoc.id;
                    const questInfo = allQuestsData[submission.questId] || { name: 'Quest Desconhecida', XP: '??' };
                    
                    pendingCount++;

                    const item = document.createElement('div');
                    item.className = 'bg-white p-4 rounded-xl shadow-lg border-l-4 border-yellow-500 space-y-2';
                    item.innerHTML = `
                        <p class="font-bold text-lg text-gray-800">${questInfo.name} <span class="text-sm font-normal text-gray-500">(${questInfo.XP} XP)</span></p>
                        <p class="text-sm text-gray-600">Aluno: ${alunoNome}</p>
                        <p class="text-sm text-gray-600">Prova (${submission.proofType}): <span class="font-semibold text-indigo-600 break-all">${submission.proofValue}</span></p>
                        <div class="flex space-x-3 pt-2">
                            <button onclick="handleApproveSubmission('${alunoId}', '${submissionId}', ${questInfo.XP})" class="flex-1 bg-green-500 text-white py-2 rounded-lg text-sm font-semibold hover:bg-green-600 transition">Aprovar XP</button>
                            <button onclick="handleRejectSubmission('${alunoId}', '${submissionId}')" class="flex-1 bg-red-500 text-white py-2 rounded-lg text-sm font-semibold hover:bg-red-600 transition">Rejeitar</button>
                        </div>
                    `;
                    listEl.appendChild(item);
                });

                if (pendingCount === 0) {
                     listEl.innerHTML = '<p class="p-4 bg-green-100 rounded-lg text-green-700">🎉 Nenhuma submissão pendente de aprovação!</p>';
                }
            });
        });
    });
}

/**
 * Manipula a criação de uma nova Quest pelo Admin.
 */
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
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        // Salva a quest em uma coleção pública para todos os alunos lerem
        await db.collection('public').doc(appId).collection('data').doc('quests').collection('list').add(newQuest);
        
        showMessage(`Quest "${name}" criada com sucesso!`, 'success');
        document.getElementById('createQuestForm').reset();
    } catch (error) {
        console.error("Erro ao criar Quest:", error);
        showMessage('Erro ao criar Quest. Verifique as permissões.', 'error');
    }
}

/**
 * Aprova uma submissão, atualiza o status e adiciona XP ao aluno.
 * @param {string} alunoId - ID do aluno.
 * @param {string} submissionId - ID da submissão.
 * @param {number} rewardXP - XP a ser concedido.
 */
async function handleApproveSubmission(alunoId, submissionId, rewardXP) {
    // 1. Atualizar o status da submissão
    const submissionRef = db.collection('alunos').doc(alunoId).collection('submissoes').doc(submissionId);
    await submissionRef.update({ 
        status: 'aprovado',
        approvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 2. Adicionar o XP ao perfil do aluno (transação segura)
    const alunoRef = db.collection('alunos').doc(alunoId);
    try {
        await db.runTransaction(async (transaction) => {
            const alunoDoc = await transaction.get(alunoRef);
            if (!alunoDoc.exists) {
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

/**
 * Rejeita uma submissão, atualizando o status.
 * @param {string} alunoId - ID do aluno.
 * @param {string} submissionId - ID da submissão.
 */
async function handleRejectSubmission(alunoId, submissionId) {
    const submissionRef = db.collection('alunos').doc(alunoId).collection('submissoes').doc(submissionId);
    
    try {
        await submissionRef.update({ 
            status: 'rejeitado',
            rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showMessage('Submissão rejeitada. O aluno pode tentar novamente.', 'info');
    } catch (error) {
        console.error("Erro ao rejeitar submissão:", error);
        showMessage('Erro ao rejeitar submissão.', 'error');
    }
}


// =====================================================================
// Funções de Simulação (Apenas para index.html)
// =====================================================================

/**
 * Simula o login como aluno e cria o perfil se necessário.
 */
async function simulateStudentLogin() {
    await setupInitialAuth();
    if (!auth.currentUser) return;
    
    // Tenta criar/atualizar o perfil para garantir o papel de 'aluno'
    await setupUserProfile(auth.currentUser, 'aluno');
    window.location.href = 'aluno.html';
}

/**
 * Simula o login como admin e cria o perfil se necessário.
 */
async function simulateAdminLogin() {
    await setupInitialAuth();
    if (!auth.currentUser) return;
    
    // Tenta criar/atualizar o perfil para garantir o papel de 'admin'
    await setupUserProfile(auth.currentUser, 'admin');
    window.location.href = 'admin.html';
}


// =====================================================================
// Inicialização e Listeners Globais
// =====================================================================

// Listener de Login padrão (e-mail/senha) na página index.html
if (document.getElementById('loginForm')) {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
}

// Listeners de Simulação (apenas para a página index.html)
if (document.getElementById('simulateStudentLogin')) {
    document.getElementById('simulateStudentLogin').addEventListener('click', simulateStudentLogin);
}
if (document.getElementById('simulateAdminLogin')) {
    document.getElementById('simulateAdminLogin').addEventListener('click', simulateAdminLogin);
}

// Listener para criação de Quest (apenas para admin.html)
if (document.getElementById('createQuestForm')) {
    document.getElementById('createQuestForm').addEventListener('submit', handleCreateQuest);
}

// Listener para envio de prova (apenas para aluno.html)
if (document.getElementById('proof-form')) {
    document.getElementById('proof-form').addEventListener('submit', handleProofSubmission);
}

// Inicia o processo de autenticação e carregamento de conteúdo
document.addEventListener('DOMContentLoaded', () => {
    // Para as páginas que não são de login, checa a autenticação e carrega o dashboard
    if (document.title.includes('Dashboard Aluno') || document.title.includes('Painel Admin')) {
        checkAuthAndRedirect();
    }
});
