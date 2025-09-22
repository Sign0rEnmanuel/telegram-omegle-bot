// IMPORTACIÓN DE LIBRERÍAS Y CONFIGURACIÓN
const Telegram = require("node-telegram-bot-api");

// VARIABLES DE CONFIGURACIÓN
const token = process.env.TELEGRAM_BOT_TOKEN;
const adminId = parseInt(process.env.ADMIN_ID) || 1928649819;

// VALIDACIÓN DEL TOKEN
if (!token || token === "TOKEN") {
    console.error('❌ ERROR: Token de Telegram no configurado correctamente');
    console.log('💡 Verifica que tu archivo token.env contenga:');
    console.log('TELEGRAM_BOT_TOKEN=tu_token_real_aqui');
    console.log('ADMIN_ID=1928649819');
    process.exit(1);
}

console.log('✅ Token cargado correctamente desde token.env');

// CONFIGURACIÓN DEL BOT
const bot = new Telegram(token, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 60
        }
    }
});

// CONFIGURACIÓN DE ADMINISTRADOR
console.log(`✅ Bot configurado. Admin ID: ${adminId}`);

// MANEJO DE ERRORES GLOBALES MEJORADO
bot.on('polling_error', (error) => {
    console.error('❌ Error de polling:', error.code);
    if (error.code === 'EFATAL') {
        console.log('🔄 Reintentando conexión en 5 segundos...');
        setTimeout(() => {
            console.log('🔄 Reiniciando bot...');
            bot.stopPolling();
            setTimeout(() => {
                bot.startPolling();
            }, 1000);
        }, 5000);
    }
});

bot.on('error', (error) => {
    console.error('❌ Error del bot:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.log('🔄 Intentando continuar...');
});

// ALMACENAMIENTO EN MEMORIA
const usuarios = {};
const usuariosEnEspera = [];
const reportes = [];
const usuariosBaneados = new Set();

// MENSAJES DEL BOT
const mensajes = {
    bienvenida: (nombre) => `¡Hola, ${nombre} 👋👋! Bienvenido a mi bot de Telegram.
Funciono como Omegle para que puedas chatear con gente nueva.
Si tienes dudas, usa el comando /help.`,
    help: `Estos son todos nuestros comandos:
/start: Inicia el bot y busca un compañero.
/stop: Termina el chat con tu compañero actual.
/report [motivo]: Reporta a tu compañero actual por comportamiento inapropiado.
Ejemplo: /report Contenido ofensivo`,
    encontrado: (companero) => `¡Has sido emparejado con un compañero! 🎉
👤 Usuario: ${companero.nombre}
🆔 ID: ${companero.id}
📝 Para reportar: /report [motivo]
💬 Puedes empezar a chatear ahora.`,
    esperando: "Esperando a un compañero...",
    ya_tienes_companero: "Ya tienes un compañero. Usa /stop si quieres terminar el chat.",
    chat_terminado: "Has terminado el chat con tu compañero.",
    companero_termino: "Tu compañero ha terminado el chat.",
    no_chat_activo: "No tienes ningún chat activo.",
    mensaje_no_soportado: "[Mensaje no soportado]",
    error_general: "Ocurrió un error. Por favor, inténtalo de nuevo.",
    error_envio: "No pude enviar tu mensaje. Tu compañero puede haber salido del chat.",
    usuario_baneado: "Tu cuenta ha sido suspendida por violar las normas del bot.",
    reporte_enviado: "✅ Reporte enviado correctamente al administrador.",
    reporte_sin_motivo: "❌ Debes especificar un motivo para el reporte.\nEjemplo: /report Contenido ofensivo",
    no_companero_reportar: "❌ No tienes un compañero activo para reportar.",
};

// FUNCIÓN AUXILIAR PARA VERIFICAR TIPOS DE MENSAJE SOPORTADOS
function esMensajeSoportado(msg) {
    return !!(msg.text || msg.photo || msg.voice || msg.sticker || msg.document || msg.video || msg.audio || msg.animation || msg.video_note || msg.location || msg.contact);
}

// COMANDO /start
bot.onText(/\/start/, async (msg) => {
    const id = msg.chat.id;
    const nombre = msg.from.first_name || msg.from.username || "Usuario";
    try {
        // Verificar si el usuario está baneado
        if (usuariosBaneados.has(id)) {
            await bot.sendMessage(id, mensajes.usuario_baneado);
            return;
        }
        
        if (!usuarios[id]) {
            usuarios[id] = { id, nombre, companero: null };
        }
        
        const opciones = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Buscar compañero", callback_data: "find" }],
                ],
            },
        };
        
        await bot.sendMessage(id, mensajes.bienvenida(nombre), opciones);
    } catch (error) {
        console.error(`Error en comando /start para usuario ${id}:`, error);
        try {
            await bot.sendMessage(id, mensajes.error_general);
        } catch (fallbackError) {
            console.error(`Error crítico enviando mensaje de error:`, fallbackError);
        }
    }
});

// COMANDO /help
bot.onText(/\/help/, async (msg) => {
    try {
        await bot.sendMessage(msg.chat.id, mensajes.help);
    } catch (error) {
        console.error(`Error en comando /help para usuario ${msg.chat.id}:`, error);
    }
});

// GESTIÓN DE CALLBACK QUERIES (CLICK EN BOTONES) - CORREGIDO
bot.on("callback_query", async (query) => {
    const id = query.from.id;
    const data = query.data;
    
    try {
        // Crear usuario si no existe
        if (!usuarios[id]) {
            const nombre = query.from.first_name || query.from.username || "Usuario";
            usuarios[id] = { id, nombre, companero: null };
        }
        
        // Lógica para el botón "Buscar compañero"
        if (data === "find") {
            // Verificar si el usuario está baneado
            if (usuariosBaneados.has(id)) {
                await bot.answerCallbackQuery(query.id, { text: mensajes.usuario_baneado });
                return;
            }
            
            // Si ya tiene un compañero, no hace nada
            if (usuarios[id]?.companero) {
                await bot.answerCallbackQuery(query.id, { text: mensajes.ya_tienes_companero });
                return;
            }
            
            // Si ya está en la cola, no lo agrega de nuevo
            if (usuariosEnEspera.includes(id)) {
                await bot.answerCallbackQuery(query.id, { text: mensajes.esperando });
                return;
            }
            
            // LÓGICA CORREGIDA PARA EMPAREJAR
            if (usuariosEnEspera.length > 0) {
                // Buscar un compañero válido
                let idCompanero = null;
                while (usuariosEnEspera.length > 0) {
                    const candidato = usuariosEnEspera.shift();
                    if (usuarios[candidato] && !usuariosBaneados.has(candidato) && candidato !== id) {
                        idCompanero = candidato;
                        break;
                    }
                }
                
                if (idCompanero) {
                    // Emparejar a los dos usuarios
                    usuarios[id].companero = idCompanero;
                    usuarios[idCompanero].companero = id;
                    
                    // Enviar mensajes con información del compañero
                    await Promise.all([
                        bot.sendMessage(id, mensajes.encontrado(usuarios[idCompanero])),
                        bot.sendMessage(idCompanero, mensajes.encontrado(usuarios[id])),
                        bot.answerCallbackQuery(query.id, { text: "¡Compañero encontrado!" })
                    ]);
                } else {
                    // No hay compañeros válidos, agregar a la cola
                    usuariosEnEspera.push(id);
                    await bot.answerCallbackQuery(query.id, { text: "Esperando a un compañero..." });
                }
            } else {
                // Si no hay nadie esperando, se agrega a la cola
                usuariosEnEspera.push(id);
                await bot.answerCallbackQuery(query.id, { text: "Esperando a un compañero..." });
            }
        }
    } catch (error) {
        console.error(`Error en callback query para usuario ${id}:`, error);
        try {
            await bot.answerCallbackQuery(query.id, { text: mensajes.error_general });
        } catch (fallbackError) {
            console.error(`Error crítico en callback query:`, fallbackError);
        }
    }
});

// COMANDO /report
bot.onText(/\/report(.*)/, async (msg, match) => {
    const id = msg.chat.id;
    const motivo = match[1] ? match[1].trim() : "";
    
    try {
        // Verificar si el usuario está baneado
        if (usuariosBaneados.has(id)) {
            await bot.sendMessage(id, mensajes.usuario_baneado);
            return;
        }

        // Verificar si tiene un compañero para reportar
        const companeroId = usuarios[id]?.companero;
        if (!companeroId) {
            await bot.sendMessage(id, mensajes.no_companero_reportar);
            return;
        }

        // Verificar si especificó un motivo
        if (!motivo) {
            await bot.sendMessage(id, mensajes.reporte_sin_motivo);
            return;
        }

        // Crear el reporte
        const reporte = {
            id: reportes.length + 1,
            fecha: new Date(),
            reportador: {
                id: id,
                nombre: usuarios[id]?.nombre || "Usuario desconocido"
            },
            reportado: {
                id: companeroId,
                nombre: usuarios[companeroId]?.nombre || "Usuario desconocido"
            },
            motivo: motivo,
            estado: "pendiente"
        };

        // Guardar el reporte
        reportes.push(reporte);

        // Crear mensaje para el admin
        const mensajeAdmin = `🚨 NUEVO REPORTE #${reporte.id}

📅 Fecha: ${reporte.fecha.toLocaleString('es-ES')}
👤 Reportador: ${reporte.reportador.nombre} (ID: ${reporte.reportador.id})
🎯 Reportado: ${reporte.reportado.nombre} (ID: ${reporte.reportado.id})
📝 Motivo: ${reporte.motivo}

Comandos de administrador:
/ban ${reporte.reportado.id} - Banear usuario
/unban ${reporte.reportado.id} - Desbanear usuario
/reports - Ver todos los reportes`;

        // Enviar reporte al admin
        await bot.sendMessage(adminId, mensajeAdmin);
        
        // Confirmar al usuario que reportó
        await bot.sendMessage(id, mensajes.reporte_enviado);

        console.log(`Nuevo reporte #${reporte.id}: Usuario ${id} reportó a ${companeroId} por: ${motivo}`);

    } catch (error) {
        console.error(`Error en comando /report para usuario ${id}:`, error);
        try {
            await bot.sendMessage(id, mensajes.error_general);
        } catch (fallbackError) {
            console.error(`Error crítico en /report:`, fallbackError);
        }
    }
});

// COMANDO /stop
bot.onText(/\/stop/, async (msg) => {
    const id = msg.chat.id;
    
    try {
        // Verificar si el usuario está baneado
        if (usuariosBaneados.has(id)) {
            await bot.sendMessage(id, mensajes.usuario_baneado);
            return;
        }
        
        const companeroId = usuarios[id]?.companero;
        
        // Si está en la cola de espera, lo saca
        const index = usuariosEnEspera.indexOf(id);
        if (index !== -1) {
            usuariosEnEspera.splice(index, 1);
            await bot.sendMessage(id, "Has salido de la cola de espera.");
            return;
        }
        
        // Si tiene un compañero, termina el chat para ambos
        if (companeroId) {
            usuarios[id].companero = null;
            if (usuarios[companeroId]) {
                usuarios[companeroId].companero = null;
            }
            
            const promises = [bot.sendMessage(id, mensajes.chat_terminado)];
            if (companeroId && usuarios[companeroId]) {
                promises.push(bot.sendMessage(companeroId, mensajes.companero_termino));
            }
            
            await Promise.all(promises);
        } else {
            // Si no tiene compañero ni está en la cola
            await bot.sendMessage(id, mensajes.no_chat_activo);
        }
    } catch (error) {
        console.error(`Error en comando /stop para usuario ${id}:`, error);
        try {
            await bot.sendMessage(id, mensajes.error_general);
        } catch (fallbackError) {
            console.error(`Error crítico en /stop:`, fallbackError);
        }
    }
});

// COMANDOS DE ADMINISTRADOR
// Comando /ban para banear usuarios (solo admin)
bot.onText(/\/ban (\d+)/, async (msg, match) => {
    const adminUserId = msg.chat.id;
    const userToBan = parseInt(match[1]);
    
    if (adminUserId !== adminId) {
        return; // Solo el admin puede usar este comando
    }
    
    try {
        usuariosBaneados.add(userToBan);
        
        // Desconectar al usuario si está en chat
        const companeroId = usuarios[userToBan]?.companero;
        if (companeroId) {
            usuarios[userToBan].companero = null;
            if (usuarios[companeroId]) {
                usuarios[companeroId].companero = null;
                await bot.sendMessage(companeroId, "Tu compañero ha sido desconectado.");
            }
        }
        
        // Remover de la cola de espera si está ahí
        const index = usuariosEnEspera.indexOf(userToBan);
        if (index > -1) {
            usuariosEnEspera.splice(index, 1);
        }
        
        await bot.sendMessage(adminId, `✅ Usuario ${userToBan} ha sido baneado correctamente.`);
        
        // Notificar al usuario baneado
        try {
            await bot.sendMessage(userToBan, mensajes.usuario_baneado);
        } catch (error) {
            // El usuario puede haber bloqueado el bot
            console.log(`No se pudo notificar al usuario baneado ${userToBan}`);
        }
        
    } catch (error) {
        console.error(`Error baneando usuario ${userToBan}:`, error);
        await bot.sendMessage(adminId, `❌ Error al banear usuario ${userToBan}`);
    }
});

// Comando /unban para desbanear usuarios (solo admin)
bot.onText(/\/unban (\d+)/, async (msg, match) => {
    const adminUserId = msg.chat.id;
    const userToUnban = parseInt(match[1]);
    
    if (adminUserId !== adminId) {
        return; // Solo el admin puede usar este comando
    }
    
    try {
        if (usuariosBaneados.has(userToUnban)) {
            usuariosBaneados.delete(userToUnban);
            await bot.sendMessage(adminId, `✅ Usuario ${userToUnban} ha sido desbaneado correctamente.`);
        } else {
            await bot.sendMessage(adminId, `ℹ️ El usuario ${userToUnban} no estaba baneado.`);
        }
    } catch (error) {
        console.error(`Error desbaneando usuario ${userToUnban}:`, error);
        await bot.sendMessage(adminId, `❌ Error al desbanear usuario ${userToUnban}`);
    }
});

// Comando /reports para ver todos los reportes (solo admin)
bot.onText(/\/reports/, async (msg) => {
    const adminUserId = msg.chat.id;
    
    if (adminUserId !== adminId) {
        return; // Solo el admin puede usar este comando
    }
    
    try {
        if (reportes.length === 0) {
            await bot.sendMessage(adminId, "📝 No hay reportes registrados.");
            return;
        }
        
        const ultimosReportes = reportes.slice(-10); // Mostrar últimos 10 reportes
        let mensaje = "📋 ÚLTIMOS REPORTES:\n\n";
        
        for (const reporte of ultimosReportes) {
            mensaje += `🆔 #${reporte.id} | ${reporte.fecha.toLocaleDateString('es-ES')}
👤 ${reporte.reportador.nombre} reportó a ${reporte.reportado.nombre}
📝 ${reporte.motivo}
🎯 ID Reportado: ${reporte.reportado.id}
\n`;
        }
        
        mensaje += `\nTotal de reportes: ${reportes.length}`;
        
        await bot.sendMessage(adminId, mensaje);
        
    } catch (error) {
        console.error(`Error mostrando reportes:`, error);
        await bot.sendMessage(adminId, `❌ Error al mostrar reportes`);
    }
});

// REDIRIGE MENSAJES ENTRE COMPAÑEROS - MEJORADO
bot.on("message", async (msg) => {
    const id = msg.chat.id;
    
    // Ignorar mensajes de grupos/canales
    if (msg.chat.type !== 'private') return;
    
    // Ignorar comandos
    if (msg.text && msg.text.startsWith("/")) return;
    
    // Verificar si es un mensaje soportado - MEJORADO
    if (!esMensajeSoportado(msg)) {
        try {
            await bot.sendMessage(id, "⚠️ Este tipo de mensaje no puede ser reenviado.");
        } catch (error) {
            console.error('Error enviando mensaje de advertencia:', error);
        }
        return;
    }

    // Verificar si el usuario está baneado
    if (usuariosBaneados.has(id)) {
        try {
            await bot.sendMessage(id, mensajes.usuario_baneado);
        } catch (error) {
            console.error(`Error enviando mensaje de baneo:`, error);
        }
        return;
    }

    // Verificar si el usuario existe
    if (!usuarios[id]) {
        return;
    }

    const companeroId = usuarios[id]?.companero;

    if (companeroId) {
        try {
            // Verificar que el compañero aún existe y no está baneado
            if (!usuarios[companeroId] || usuariosBaneados.has(companeroId)) {
                usuarios[id].companero = null;
                await bot.sendMessage(id, "Tu compañero ya no está disponible. El chat ha terminado.");
                return;
            }
            
            // Reenviar el mensaje
            await bot.copyMessage(companeroId, id, msg.message_id);
            console.log(`📤 Mensaje reenviado de ${id} a ${companeroId}`);
        } catch (error) {
            console.error(`Error enviando mensaje entre usuarios ${id} y ${companeroId}:`, error);
            
            try {
                await bot.sendMessage(id, mensajes.error_envio);
                if (usuarios[id]) usuarios[id].companero = null;
                if (usuarios[companeroId]) usuarios[companeroId].companero = null;
            } catch (fallbackError) {
                console.error(`Error crítico notificando fallo de envío:`, fallbackError);
            }
        }
    } else {
        try {
            await bot.sendMessage(id, "No tienes un compañero activo. Usa /start para buscar uno.");
        } catch (error) {
            console.error(`Error enviando sugerencia:`, error);
        }
    }
});

// LIMPIEZA PERIÓDICA MEJORADA
setInterval(() => {
    // Limpiar cola de espera de usuarios inexistentes
    for (let i = usuariosEnEspera.length - 1; i >= 0; i--) {
        const userId = usuariosEnEspera[i];
        if (!usuarios[userId] || usuariosBaneados.has(userId)) {
            usuariosEnEspera.splice(i, 1);
            console.log(`Limpiado usuario ${userId} de la cola de espera`);
        }
    }
    
    // Limpiar conexiones huérfanas
    for (const userId in usuarios) {
        const companeroId = usuarios[userId].companero;
        if (companeroId && (!usuarios[companeroId] || usuarios[companeroId].companero !== parseInt(userId))) {
            usuarios[userId].companero = null;
            console.log(`Limpiada conexión huérfana del usuario ${userId}`);
        }
    }
}, 300000); // Cada 5 minutos

console.log('🤖 Bot iniciado correctamente ✅');
console.log('📁 Token cargado desde: token.env');
console.log(`👤 Admin ID: ${adminId}`);