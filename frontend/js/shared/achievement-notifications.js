function achievementsDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

/**
 * Sistema de Notificações de Conquistas
 * 
 * Gerencia notificações em tela (toasts) para conquistas desbloqueadas
 * Funciona em todas as páginas do jogo
 */

// Cache de conquistas carregadas do Firebase
let ACHIEVEMENTS_CONFIG = [];
const FIREBASE_CACHE_KEY = 'cx_achievements_firebase';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const ACHIEVEMENT_PUSH_NOTIFICATIONS_ENABLED = false;

function getCxSessionToken() {
    return sessionStorage.getItem('cx_session_token') || localStorage.getItem('cx_session_token') || '';
}

async function loadProtectedFlowStatus(seasonId = 'S-2025-01') {
    const token = getCxSessionToken();
    if (!token) {
        return null;
    }

    const response = await fetch(`/api/user-flow-status?seasonId=${encodeURIComponent(seasonId)}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`
        }
    });

    if (!response.ok) {
        throw new Error(`flow_status_${response.status}`);
    }

    return response.json();
}

/**
 * Carrega conquistas do JSON local (fallback)
 */
async function loadAchievementsFromJSON() {
    try {
        const response = await fetch('/frontend/data/achievements.json');
        if (!response.ok) {
            throw new Error('Failed to load achievements.json');
        }
        const data = await response.json();
        achievementsDebugLog('[Achievements] ✅ Loaded from JSON fallback:', data.achievements.length);
        return data.achievements;
    } catch (error) {
        console.error('[Achievements] Error loading from JSON:', error);
        return [];
    }
}

/**
 * Carrega conquistas do Firebase (com cache)
 */
async function loadAchievementsFromFirebase() {
    // 1. Checar cache de sessão
    const cached = sessionStorage.getItem(FIREBASE_CACHE_KEY);
    if (cached) {
        try {
            const { data, _ts } = JSON.parse(cached);
            const age = Date.now() - _ts;
            if (age < CACHE_TTL_MS) {
                achievementsDebugLog('[Achievements] Using cached achievements from Firebase');
                return data;
            }
        } catch (e) {
            console.warn('[Achievements] Cache parse error:', e);
        }
    }

    // 2. Buscar do Firebase Firestore
    if (!window.firebaseDb) {
        console.warn('[Achievements] Firebase not initialized, using JSON fallback');
        return await loadAchievementsFromJSON();
    }

    try {
        if (typeof window.firebaseDb.collection === 'function') {
            // Firestore
            const achievementsRef = window.firebaseDb.collection('achievements');
            const snapshot = await achievementsRef.get();
            
            if (snapshot.empty) {
                console.warn('[Achievements] No achievements found in Firestore, using JSON fallback');
                return await loadAchievementsFromJSON();
            }

            const achievements = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            sessionStorage.setItem(FIREBASE_CACHE_KEY, JSON.stringify({
                data: achievements,
                _ts: Date.now()
            }));

            achievementsDebugLog(`[Achievements] ✅ ${achievements.length} achievements loaded from Firestore`);
            return achievements;
        } else {
            // Realtime Database not supported, use JSON fallback
            console.warn('[Achievements] Realtime Database not configured, using JSON fallback');
            return await loadAchievementsFromJSON();
        }

    } catch (error) {
        console.error('[Achievements] Error loading from Firebase, using JSON fallback:', error);
        return await loadAchievementsFromJSON();
    }
}

/**
 * Inicializa as conquistas (carrega do Firebase com fallback para JSON)
 */
async function initializeAchievements() {
    if (ACHIEVEMENTS_CONFIG.length > 0) {
        return ACHIEVEMENTS_CONFIG; // Já carregado
    }

    ACHIEVEMENTS_CONFIG = await loadAchievementsFromFirebase();
    return ACHIEVEMENTS_CONFIG;
}

/**
 * Obtém estatísticas do usuário do localStorage/sessionStorage
 */
function getUserStats() {
    const storage = localStorage.getItem('cx_logged_in_user') ? localStorage : sessionStorage;
    const loggedInUser = storage.getItem('cx_logged_in_user');
    
    if (!loggedInUser) return null;
    
    const users = JSON.parse(storage.getItem('cx_users') || '{}');
    const user = users[loggedInUser];
    
    if (!user) return null;
    
    return {
        xp: user.xp || 0,
        level: user.level || 1,
        completedChallenges: (user.completedChallenges || []).length,
        completedMinigames: (user.completedMinigames || []).length,
        failedChallenges: (user.failedChallenges || []).length,
        combined: (user.completedChallenges || []).length + (user.completedMinigames || []).length,
        logumChallenges: (user.logumChallenges || []).length,
        // Dados brutos para verificações especiais
        completedChallengesArray: user.completedChallenges || [],
        failedChallengesArray: user.failedChallenges || [],
        logumChallengesArray: user.logumChallenges || []
    };
}

/**
 * Verifica o desempenho em todas as fases (para conquistas especiais)
 * Retorna: 'perfect' (100%), 'balanced' (média), 'zero' (0%), ou null (não finalizado)
 */
async function checkAllLevelsPerformance() {
    const storage = localStorage.getItem('cx_logged_in_user') ? localStorage : sessionStorage;
    const loggedInUser = storage.getItem('cx_logged_in_user');
    
    if (!loggedInUser) return null;
    
    const users = JSON.parse(storage.getItem('cx_users') || '{}');
    const user = users[loggedInUser];
    
    if (!user || !user.id) return null;
    
    try {
        const flowStatus = await loadProtectedFlowStatus('S-2025-01');
        const statusData = Array.isArray(flowStatus?.challenge_statuses) ? flowStatus.challenge_statuses : [];
        if (!statusData.length) return null;
        
        // Calcular desempenho por nível
        const levels = [1, 2, 3];
        const levelStats = {};
        let allLevelsFinalized = true;
        
        for (const level of levels) {
            const levelPattern = new RegExp(`${level}\\d{2}`);
            const levelChallenges = statusData.filter(s => levelPattern.test(s.challenge_id));
            
            const completed = levelChallenges.filter(s => s.status === 'completed').length;
            const failed = levelChallenges.filter(s => s.status === 'failed').length;
            const processed = completed + failed;
            
            // Cada nível tem 20 desafios
            if (processed < 20) {
                allLevelsFinalized = false;
                break;
            }
            
            const completionRate = Math.round((completed / 20) * 100);
            levelStats[level] = { completed, failed, processed, completionRate };
        }
        
        // Se não finalizou todos os níveis, não verificar conquistas especiais
        if (!allLevelsFinalized) return null;
        
        // Calcular média geral
        const totalCompleted = Object.values(levelStats).reduce((sum, s) => sum + s.completed, 0);
        const totalChallenges = 60; // 3 níveis x 20 desafios
        const overallRate = Math.round((totalCompleted / totalChallenges) * 100);
        
        achievementsDebugLog('[Achievements] All levels performance:', {
            levelStats,
            overallRate,
            totalCompleted,
            totalChallenges
        });
        
        // Determinar tipo de conquista
        if (overallRate === 100) {
            return 'perfect'; // Ultra Instinct
        } else if (overallRate === 0) {
            return 'zero'; // Skill Issue
        } else if (overallRate >= 40 && overallRate <= 60) {
            return 'balanced'; // Perfeitamente Equilibrado (entre 40-60%)
        }
        
        return null;
        
    } catch (error) {
        console.error('[Achievements] Error checking all levels performance:', error);
        return null;
    }
}

/**
 * Obtém conquistas já desbloqueadas do localStorage
 */
function getUnlockedAchievements() {
    const storage = localStorage.getItem('cx_logged_in_user') ? localStorage : sessionStorage;
    const loggedInUser = storage.getItem('cx_logged_in_user');
    
    if (!loggedInUser) return [];
    
    const users = JSON.parse(storage.getItem('cx_users') || '{}');
    const user = users[loggedInUser];
    
    return user?.unlockedAchievements || [];
}

/**
 * Salva conquista desbloqueada no localStorage
 */
function saveUnlockedAchievement(achievementId) {
    const storage = localStorage.getItem('cx_logged_in_user') ? localStorage : sessionStorage;
    const loggedInUser = storage.getItem('cx_logged_in_user');
    
    if (!loggedInUser) return;
    
    const users = JSON.parse(storage.getItem('cx_users') || '{}');
    const user = users[loggedInUser];
    
    if (!user) return;
    
    if (!user.unlockedAchievements) {
        user.unlockedAchievements = [];
    }
    
    if (!user.unlockedAchievements.includes(achievementId)) {
        user.unlockedAchievements.push(achievementId);
        users[loggedInUser] = user;
        storage.setItem('cx_users', JSON.stringify(users));
        achievementsDebugLog('[Achievements] Unlocked:', achievementId);
    }
}

/**
 * Verifica se uma conquista foi desbloqueada
 */
async function checkAchievementUnlocked(achievement, stats, allLevelsPerformance) {
    if (!stats) return false;
    
    switch (achievement.type) {
        case 'xp':
            return stats.xp >= achievement.target;
        case 'level':
            return stats.level >= achievement.target;
        case 'challenges':
            return stats.completedChallenges >= achievement.target;
        case 'minigames':
            return stats.completedMinigames >= achievement.target;
        case 'failed_challenges':
            return stats.failedChallenges >= achievement.target;
        case 'combined':
            return stats.combined >= achievement.target;
        case 'logum_challenges':
            // Conquista Sentury: completou pelo menos 1 desafio de texto validado por IA
            return stats.logumChallenges >= achievement.target;
        case 'all_levels_performance':
            // Conquistas especiais baseadas em desempenho em todas as fases
            if (!allLevelsPerformance) return false;
            
            if (achievement.target === 100) {
                // Ultra Instinct: 100% em tudo
                return allLevelsPerformance === 'perfect';
            } else if (achievement.target === 'balanced') {
                // Perfeitamente Equilibrado: média entre 40-60%
                return allLevelsPerformance === 'balanced';
            } else if (achievement.target === 0) {
                // Skill Issue: 0% em tudo
                return allLevelsPerformance === 'zero';
            }
            return false;
        case 'ranking':
            // The One Above All: Top 1 no ranking
            // Esta conquista será verificada quando implementarmos o ranking
            // Por enquanto, sempre retorna false
            return false;
        default:
            return false;
    }
}

/**
 * Mostra notificação de conquista desbloqueada
 */
function showAchievementNotification(title, icon, description) {
    const existing = document.querySelector('.achievement-unlock-notification');
    if (existing) {
        existing.remove();
    }
    
    const notification = document.createElement('div');
    notification.className = 'achievement-unlock-notification';
    notification.innerHTML = `
        <div class="achievement-unlock-icon">${icon}</div>
        <div class="achievement-unlock-text">
            <strong>Conquista Desbloqueada!</strong>
            <p class="achievement-unlock-title">${title}</p>
            <p class="achievement-unlock-desc">${description}</p>
        </div>
    `;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        color: white;
        padding: 1.5rem 2rem;
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.4);
        z-index: 10001;
        display: flex;
        align-items: center;
        gap: 1.5rem;
        animation: achievementSlideIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        max-width: 90%;
        width: 400px;
    `;
    
    if (!document.getElementById('achievement-animations')) {
        const style = document.createElement('style');
        style.id = 'achievement-animations';
        style.textContent = `
            @keyframes achievementSlideIn {
                from {
                    transform: translateX(-50%) translateY(-100px);
                    opacity: 0;
                }
                to {
                    transform: translateX(-50%) translateY(0);
                    opacity: 1;
                }
            }
            
            @keyframes achievementSlideOut {
                from {
                    transform: translateX(-50%) translateY(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(-50%) translateY(-100px);
                    opacity: 0;
                }
            }
            
            .achievement-unlock-icon {
                font-size: 3rem;
                line-height: 1;
            }
            
            .achievement-unlock-text {
                flex: 1;
            }
            
            .achievement-unlock-text strong {
                display: block;
                font-size: 0.875rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                margin-bottom: 0.5rem;
                opacity: 0.9;
            }
            
            .achievement-unlock-title {
                font-size: 1.25rem;
                font-weight: bold;
                margin: 0 0 0.25rem 0;
            }
            
            .achievement-unlock-desc {
                font-size: 0.875rem;
                margin: 0;
                opacity: 0.9;
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(notification);
    
    // Tocar som de conquista (se disponível)
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGGS57OihUBELTKXh8bllHAU2jdXvz3kpBSh+zPDajzsKElyx6OyrWBQLSKDf8sFuJAUuhM/z2Ik2CBhku+zooVARC0yl4fG5ZRwFNo3V7895KQUofszw2o87ChJcsejtq1gVC0ig3/LBbiQFLoTP89iJNggYZLvs6KFQEQtMpeHxuWUcBTaN1e/PeSkFKH7M8NqPOwsSXLHo7atYFQtIoN/ywW4kBS6Ez/PYiTYIGGS77OihUBELTKXh8bllHAU2jdXvz3kpBSh+zPDajzsKElyx6O2rWBULSKDf8sFuJAUuhM/z2Ik2CBhku+zooVARC0yl4fG5ZRwFNo3V7895KQUofszw2o87ChJcsejtq1gVC0ig3/LBbiQFLoTP89iJNggYZLvs6KFQEQtMpeHxuWUcBTaN1e/PeSkFKH7M8NqPOwsSXLHo7atYFQtIoN/ywW4kBS6Ez/PYiTYIGGS77OihUBELTKXh8bllHAU2jdXvz3kpBSh+zPDajzsKElyx6O2rWBULSKDf8sFuJAUuhM/z2Ik2CBhku+zooVARC0yl4fG5ZRwFNo3V7895KQUofszw2o87ChJcsejtq1gVC0ig3/LBbiQFLoTP89iJNggYZLvs6KFQEQtMpeHxuWUcBTaN1e/PeSkFKH7M8NqPOwsSXLHo7atYFQtIoN/ywW4kBS6Ez/PYiTYIGGS77OihUBELTKXh8bllHAU2jdXvz3kpBSh+zPDajzsKElyx6O2rWBULSKDf8sFuJAUuhM/z2Ik2CBhku+zooVARC0yl4fG5ZRwFNo3V7895KQUofszw2o87ChJcsejtq1gVC0ig3/LBbiQFLoTP89iJNggYZLvs6KFQEQtMpeHxuWUcBTaN1e/PeSkFKH7M8NqPOwsSXLHo7atYFQtIoN/ywW4kBS6Ez/PYiTYIGGS77OihUBELTKXh8bllHAU2jdXvz3kpBSh+zPDajzsKElyx6O2rWBULSKDf8sFuJAUuhM/z2Ik2CBhku+zooVARC0yl4fG5ZRwFNo3V7895KQUofszw2o87ChJcsejtq1gVC0ig3/LBbiQFLoTP89iJNggYZLvs6KFQEQtMpeHxuWUcBTaN1e/PeSkFKH7M8NqPOwsSXLHo7atYFQtIoN/ywW4kBS6Ez/PYiTYIGGS77OihUBELTKXh8bllHAU2jdXvz3kpBSh+zPDajzsKElyx6O2rWBULSKDf8sFuJAUuhM/z2Ik2CBhku+zooVARC0yl4fG5ZRwFNo3V7895KQUofszw2o87ChJcsejtq1gVC0ig3/LBbiQFLoTP8w==');
        audio.volume = 0.3;
        audio.play().catch(() => {}); // Ignorar erro se autoplay bloqueado
    } catch (e) {
        // Ignorar erro de áudio
    }
    
    setTimeout(() => {
        notification.style.animation = 'achievementSlideOut 0.5s ease-out';
        setTimeout(() => notification.remove(), 500);
    }, 5000);
}

/**
 * Verifica e notifica novas conquistas desbloqueadas
 * Deve ser chamado após qualquer ação que possa desbloquear conquistas
 */
async function checkAndNotifyAchievements() {
    if (!ACHIEVEMENT_PUSH_NOTIFICATIONS_ENABLED) {
        return false;
    }

    const stats = getUserStats();
    if (!stats) return;
    
    await initializeAchievements();
    
    if (ACHIEVEMENTS_CONFIG.length === 0) {
        console.warn('[Achievements] No achievements loaded, skipping check');
        return;
    }
    
    const unlockedAchievements = getUnlockedAchievements();
    
    const allLevelsPerformance = await checkAllLevelsPerformance();
    
    for (const achievement of ACHIEVEMENTS_CONFIG) {
        // Pular se já foi desbloqueada
        if (unlockedAchievements.includes(achievement.id)) {
            continue;
        }
        
        const unlocked = await checkAchievementUnlocked(achievement, stats, allLevelsPerformance);
        
        if (unlocked) {
            saveUnlockedAchievement(achievement.id);
            
            showAchievementNotification(
                achievement.title,
                achievement.icon,
                achievement.description
            );
            
            achievementsDebugLog('[Achievements] New achievement unlocked:', achievement.id);
        }
    }
}

// Exportar funções para uso global
if (typeof window !== 'undefined') {
    window.AchievementNotifications = {
        enabled: ACHIEVEMENT_PUSH_NOTIFICATIONS_ENABLED,
        check: checkAndNotifyAchievements,
        show: showAchievementNotification,
        getStats: getUserStats,
        getUnlocked: getUnlockedAchievements
    };
}
