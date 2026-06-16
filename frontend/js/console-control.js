(function installConsoleControl(root) {
    'use strict';

    if (!root) return;

    const STORAGE_KEY = 'cx_debug_logs_enabled';
    const SILENCED_METHODS = ['log', 'info', 'debug', 'warn'];
    const ALWAYS_VISIBLE_METHODS = ['error'];
    const noop = function noop() {};
    const consoleRef = root.console || {};

    if (root.__CX_CONSOLE_CONTROL__) {
        return;
    }

    const originalConsole = {};
    [...SILENCED_METHODS, ...ALWAYS_VISIBLE_METHODS].forEach((method) => {
        const originalMethod = consoleRef[method];
        originalConsole[method] = typeof originalMethod === 'function'
            ? originalMethod.bind(consoleRef)
            : noop;
    });

    const banner = `
███████╗██╗  ██╗██████╗  ██████╗ ██████╗ ███╗   ██╗███╗   ██╗███████╗ ██████╗████████╗
██╔════╝╚██╗██╔╝██╔══██╗██╔════╝██╔═══██╗████╗  ██║████╗  ██║██╔════╝██╔════╝╚══██╔══╝
█████╗   ╚███╔╝ ██████╔╝██║     ██║   ██║██╔██╗ ██║██╔██╗ ██║█████╗  ██║        ██║
██╔══╝   ██╔██╗ ██╔═══╝ ██║     ██║   ██║██║╚██╗██║██║╚██╗██║██╔══╝  ██║        ██║
███████╗██╔╝ ██╗██║     ╚██████╗╚██████╔╝██║ ╚████║██║ ╚████║███████╗╚██████╗   ██║
╚══════╝╚═╝  ╚═╝╚═╝      ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═══╝╚══════╝ ╚═════╝   ╚═╝

👋 Você abriu o console!

Achou um bug?
A gente chama isso de missão secundária.

🎮 Experience Connect
XP, desafios e conexão em uma só jornada.

🚀 Curte explorar por trás da tela?
Então você já ganhou pontos com a gente.
`;

    function readStoredPreference() {
        try {
            return root.localStorage?.getItem(STORAGE_KEY) === 'true';
        } catch (error) {
            return false;
        }
    }

    function writeStoredPreference(enabled) {
        try {
            root.localStorage?.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
        } catch (error) {
            // Ignore storage errors so console control never blocks the page.
        }
    }

    let debugLogsEnabled = readStoredPreference();

    function setConsoleState() {
        SILENCED_METHODS.forEach((method) => {
            consoleRef[method] = function controlledConsoleMethod(...args) {
                if (debugLogsEnabled) {
                    originalConsole[method](...args);
                }
            };
        });

        ALWAYS_VISIBLE_METHODS.forEach((method) => {
            consoleRef[method] = function visibleConsoleMethod(...args) {
                originalConsole[method](...args);
            };
        });
    }

    function setDebugLogsEnabled(enabled, persist = true) {
        debugLogsEnabled = Boolean(enabled);
        if (persist) {
            writeStoredPreference(debugLogsEnabled);
        }
        setConsoleState();
    }

    function mostrarLog() {
        setDebugLogsEnabled(true);
        originalConsole.log('[Experience Connect] Logs de debug ativados.');
    }

    function esconderLog() {
        setDebugLogsEnabled(false);
        originalConsole.log('[Experience Connect] Logs de debug escondidos.');
    }

    function logsAtivos() {
        return debugLogsEnabled;
    }

    root.__CX_CONSOLE_CONTROL__ = {
        storageKey: STORAGE_KEY,
        mostrarLog,
        esconderLog,
        logsAtivos
    };

    root.mostrarLog = mostrarLog;
    root.esconderLog = esconderLog;
    root.showLogs = mostrarLog;
    root.hideLogs = esconderLog;

    originalConsole.log(banner);
    setConsoleState();
})(typeof window !== 'undefined' ? window : globalThis);
