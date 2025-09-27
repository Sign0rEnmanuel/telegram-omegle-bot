// LIBRARY IMPORTS AND CONFIGURATION
require('dotenv').config({ path: 'token.env' });
const Telegram = require("node-telegram-bot-api");

// CONFIGURATION VARIABLES
const token = process.env.TELEGRAM_BOT_TOKEN;
const adminId = parseInt(process.env.ADMIN_ID) || 1928649819;

// TOKEN VALIDATION
if (!token || token === "TOKEN") {
    console.error('❌ ERROR: Telegram token not configured correctly');
    console.log('💡 Check that your token.env file contains:');
    console.log('TELEGRAM_BOT_TOKEN=your_real_token_here');
    console.log('ADMIN_ID=1928649819');
    process.exit(1);
}

console.log('✅ Token loaded correctly from token.env');

// BOT CONFIGURATION
const bot = new Telegram(token, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: {
            timeout: 60
        }
    }
});

// ADMINISTRATOR CONFIGURATION
console.log(`✅ Bot configured. Admin ID: ${adminId}`);

// IMPROVED GLOBAL ERROR HANDLING
bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error.code);
    if (error.code === 'EFATAL') {
        console.log('🔄 Retrying connection in 5 seconds...');
        setTimeout(() => {
            console.log('🔄 Restarting bot...');
            bot.stopPolling();
            setTimeout(() => {
                bot.startPolling();
            }, 1000);
        }, 5000);
    }
});

bot.on('error', (error) => {
    console.error('❌ Bot error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    console.log('🔄 Attempting to continue...');
});

// IN-MEMORY STORAGE
const usuarios = {};
const usuariosEnEspera = [];
const reportes = [];
const usuariosBaneados = new Set();

// BOT MESSAGES
const mensajes = {
    bienvenida: (nombre) => `Hello, ${nombre} 👋👋! Welcome to my Telegram bot.
I work like Omegle so you can chat with new people.
If you have questions, use the /help command.`,
    help: `Here are all our commands:
/start: Start the bot and find a partner.
/stop: End the chat with your current partner.
/report [reason]: Report your current partner for inappropriate behavior.
Example: /report Offensive content`,
    encontrado: (companero) => `You've been paired with a partner! 🎉
👤 User: ${companero.nombre}
🆔 ID: ${companero.id}
📝 To report: /report [reason]
💬 You can start chatting now.`,
    esperando: "Waiting for a partner...",
    ya_tienes_companero: "You already have a partner. Use /stop if you want to end the chat.",
    chat_terminado: "You have ended the chat with your partner.",
    companero_termino: "Your partner has ended the chat.",
    no_chat_activo: "You don't have any active chat.",
    mensaje_no_soportado: "[Unsupported message]",
    error_general: "An error occurred. Please try again.",
    error_envio: "I couldn't send your message. Your partner may have left the chat.",
    usuario_baneado: "Your account has been suspended for violating bot rules.",
    reporte_enviado: "✅ Report sent successfully to the administrator.",
    reporte_sin_motivo: "❌ You must specify a reason for the report.\nExample: /report Offensive content",
    no_companero_reportar: "❌ You don't have an active partner to report.",
};

// HELPER FUNCTION TO VERIFY SUPPORTED MESSAGE TYPES
function esMensajeSoportado(msg) {
    return !!(msg.text || msg.photo || msg.voice || msg.sticker || msg.document || msg.video || msg.audio || msg.animation || msg.video_note || msg.location || msg.contact);
}

// COMMAND /start
bot.onText(/\/start/, async (msg) => {
    const id = msg.chat.id;
    const nombre = msg.from.first_name || msg.from.username || "User";
    try {
        // Check if user is banned
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
                    [{ text: "Find Partner", callback_data: "find" }],
                ],
            },
        };
        
        await bot.sendMessage(id, mensajes.bienvenida(nombre), opciones);
    } catch (error) {
        console.error(`Error in /start command for user ${id}:`, error);
        try {
            await bot.sendMessage(id, mensajes.error_general);
        } catch (fallbackError) {
            console.error(`Critical error sending error message:`, fallbackError);
        }
    }
});

// COMMAND /help
bot.onText(/\/help/, async (msg) => {
    try {
        await bot.sendMessage(msg.chat.id, mensajes.help);
    } catch (error) {
        console.error(`Error in /help command for user ${msg.chat.id}:`, error);
    }
});

// CALLBACK QUERIES HANDLING (BUTTON CLICKS) - FIXED
bot.on("callback_query", async (query) => {
    const id = query.from.id;
    const data = query.data;
    
    try {
        // Create user if doesn't exist
        if (!usuarios[id]) {
            const nombre = query.from.first_name || query.from.username || "User";
            usuarios[id] = { id, nombre, companero: null };
        }
        
        // Logic for "Find Partner" button
        if (data === "find") {
            // Check if user is banned
            if (usuariosBaneados.has(id)) {
                await bot.answerCallbackQuery(query.id, { text: mensajes.usuario_baneado });
                return;
            }
            
            // If already has a partner, do nothing
            if (usuarios[id]?.companero) {
                await bot.answerCallbackQuery(query.id, { text: mensajes.ya_tienes_companero });
                return;
            }
            
            // If already in queue, don't add again
            if (usuariosEnEspera.includes(id)) {
                await bot.answerCallbackQuery(query.id, { text: mensajes.esperando });
                return;
            }
            
            // FIXED MATCHING LOGIC
            if (usuariosEnEspera.length > 0) {
                // Find a valid partner
                let idCompanero = null;
                while (usuariosEnEspera.length > 0) {
                    const candidato = usuariosEnEspera.shift();
                    if (usuarios[candidato] && !usuariosBaneados.has(candidato) && candidato !== id) {
                        idCompanero = candidato;
                        break;
                    }
                }
                
                if (idCompanero) {
                    // Match both users
                    usuarios[id].companero = idCompanero;
                    usuarios[idCompanero].companero = id;
                    
                    // Send messages with partner information
                    await Promise.all([
                        bot.sendMessage(id, mensajes.encontrado(usuarios[idCompanero])),
                        bot.sendMessage(idCompanero, mensajes.encontrado(usuarios[id])),
                        bot.answerCallbackQuery(query.id, { text: "Partner found!" })
                    ]);
                } else {
                    // No valid partners, add to queue
                    usuariosEnEspera.push(id);
                    await bot.answerCallbackQuery(query.id, { text: "Waiting for a partner..." });
                }
            } else {
                // If no one is waiting, add to queue
                usuariosEnEspera.push(id);
                await bot.answerCallbackQuery(query.id, { text: "Waiting for a partner..." });
            }
        }
    } catch (error) {
        console.error(`Error in callback query for user ${id}:`, error);
        try {
            await bot.answerCallbackQuery(query.id, { text: mensajes.error_general });
        } catch (fallbackError) {
            console.error(`Critical error in callback query:`, fallbackError);
        }
    }
});

// COMMAND /report
bot.onText(/\/report(.*)/, async (msg, match) => {
    const id = msg.chat.id;
    const motivo = match[1] ? match[1].trim() : "";
    
    try {
        // Check if user is banned
        if (usuariosBaneados.has(id)) {
            await bot.sendMessage(id, mensajes.usuario_baneado);
            return;
        }

        // Check if has a partner to report
        const companeroId = usuarios[id]?.companero;
        if (!companeroId) {
            await bot.sendMessage(id, mensajes.no_companero_reportar);
            return;
        }

        // Check if specified a reason
        if (!motivo) {
            await bot.sendMessage(id, mensajes.reporte_sin_motivo);
            return;
        }

        // Create the report
        const reporte = {
            id: reportes.length + 1,
            fecha: new Date(),
            reportador: {
                id: id,
                nombre: usuarios[id]?.nombre || "Unknown user"
            },
            reportado: {
                id: companeroId,
                nombre: usuarios[companeroId]?.nombre || "Unknown user"
            },
            motivo: motivo,
            estado: "pending"
        };

        // Save the report
        reportes.push(reporte);

        // Create message for admin
        const mensajeAdmin = `🚨 NEW REPORT #${reporte.id}

📅 Date: ${reporte.fecha.toLocaleString('en-US')}
👤 Reporter: ${reporte.reportador.nombre} (ID: ${reporte.reportador.id})
🎯 Reported: ${reporte.reportado.nombre} (ID: ${reporte.reportado.id})
📝 Reason: ${reporte.motivo}

Admin commands:
/ban ${reporte.reportado.id} - Ban user
/unban ${reporte.reportado.id} - Unban user
/reports - View all reports`;

        // Send report to admin
        await bot.sendMessage(adminId, mensajeAdmin);
        
        // Confirm to reporting user
        await bot.sendMessage(id, mensajes.reporte_enviado);

        console.log(`New report #${reporte.id}: User ${id} reported ${companeroId} for: ${motivo}`);

    } catch (error) {
        console.error(`Error in /report command for user ${id}:`, error);
        try {
            await bot.sendMessage(id, mensajes.error_general);
        } catch (fallbackError) {
            console.error(`Critical error in /report:`, fallbackError);
        }
    }
});

// COMMAND /stop
bot.onText(/\/stop/, async (msg) => {
    const id = msg.chat.id;
    
    try {
        // Check if user is banned
        if (usuariosBaneados.has(id)) {
            await bot.sendMessage(id, mensajes.usuario_baneado);
            return;
        }
        
        const companeroId = usuarios[id]?.companero;
        
        // If in waiting queue, remove them
        const index = usuariosEnEspera.indexOf(id);
        if (index !== -1) {
            usuariosEnEspera.splice(index, 1);
            await bot.sendMessage(id, "You have left the waiting queue.");
            return;
        }
        
        // If has a partner, end chat for both
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
            // If no partner and not in queue
            await bot.sendMessage(id, mensajes.no_chat_activo);
        }
    } catch (error) {
        console.error(`Error in /stop command for user ${id}:`, error);
        try {
            await bot.sendMessage(id, mensajes.error_general);
        } catch (fallbackError) {
            console.error(`Critical error in /stop:`, fallbackError);
        }
    }
});

// ADMINISTRATOR COMMANDS
// Command /ban to ban users (admin only)
bot.onText(/\/ban (\d+)/, async (msg, match) => {
    const adminUserId = msg.chat.id;
    const userToBan = parseInt(match[1]);
    
    if (adminUserId !== adminId) {
        return; // Only admin can use this command
    }
    
    try {
        usuariosBaneados.add(userToBan);
        
        // Disconnect user if in chat
        const companeroId = usuarios[userToBan]?.companero;
        if (companeroId) {
            usuarios[userToBan].companero = null;
            if (usuarios[companeroId]) {
                usuarios[companeroId].companero = null;
                await bot.sendMessage(companeroId, "Your partner has been disconnected.");
            }
        }
        
        // Remove from waiting queue if there
        const index = usuariosEnEspera.indexOf(userToBan);
        if (index > -1) {
            usuariosEnEspera.splice(index, 1);
        }
        
        await bot.sendMessage(adminId, `✅ User ${userToBan} has been banned successfully.`);
        
        // Notify banned user
        try {
            await bot.sendMessage(userToBan, mensajes.usuario_baneado);
        } catch (error) {
            // User may have blocked the bot
            console.log(`Could not notify banned user ${userToBan}`);
        }
        
    } catch (error) {
        console.error(`Error banning user ${userToBan}:`, error);
        await bot.sendMessage(adminId, `❌ Error banning user ${userToBan}`);
    }
});

// Command /unban to unban users (admin only)
bot.onText(/\/unban (\d+)/, async (msg, match) => {
    const adminUserId = msg.chat.id;
    const userToUnban = parseInt(match[1]);
    
    if (adminUserId !== adminId) {
        return; // Only admin can use this command
    }
    
    try {
        if (usuariosBaneados.has(userToUnban)) {
            usuariosBaneados.delete(userToUnban);
            await bot.sendMessage(adminId, `✅ User ${userToUnban} has been unbanned successfully.`);
        } else {
            await bot.sendMessage(adminId, `ℹ️ User ${userToUnban} was not banned.`);
        }
    } catch (error) {
        console.error(`Error unbanning user ${userToUnban}:`, error);
        await bot.sendMessage(adminId, `❌ Error unbanning user ${userToUnban}`);
    }
});

// Command /reports to view all reports (admin only)
bot.onText(/\/reports/, async (msg) => {
    const adminUserId = msg.chat.id;
    
    if (adminUserId !== adminId) {
        return; // Only admin can use this command
    }
    
    try {
        if (reportes.length === 0) {
            await bot.sendMessage(adminId, "📄 No reports registered.");
            return;
        }
        
        const ultimosReportes = reportes.slice(-10); // Show last 10 reports
        let mensaje = "📋 LATEST REPORTS:\n\n";
        
        for (const reporte of ultimosReportes) {
            mensaje += `🆔 #${reporte.id} | ${reporte.fecha.toLocaleDateString('en-US')}
👤 ${reporte.reportador.nombre} reported ${reporte.reportado.nombre}
📝 ${reporte.motivo}
🎯 Reported ID: ${reporte.reportado.id}
\n`;
        }
        
        mensaje += `\nTotal reports: ${reportes.length}`;
        
        await bot.sendMessage(adminId, mensaje);
        
    } catch (error) {
        console.error(`Error showing reports:`, error);
        await bot.sendMessage(adminId, `❌ Error showing reports`);
    }
});

// FORWARD MESSAGES BETWEEN PARTNERS - IMPROVED
bot.on("message", async (msg) => {
    const id = msg.chat.id;
    
    // Ignore group/channel messages
    if (msg.chat.type !== 'private') return;
    
    // Ignore commands
    if (msg.text && msg.text.startsWith("/")) return;
    
    // Check if supported message - IMPROVED
    if (!esMensajeSoportado(msg)) {
        try {
            await bot.sendMessage(id, "⚠️ This type of message cannot be forwarded.");
        } catch (error) {
            console.error('Error sending warning message:', error);
        }
        return;
    }

    // Check if user is banned
    if (usuariosBaneados.has(id)) {
        try {
            await bot.sendMessage(id, mensajes.usuario_baneado);
        } catch (error) {
            console.error(`Error sending ban message:`, error);
        }
        return;
    }

    // Check if user exists
    if (!usuarios[id]) {
        return;
    }

    const companeroId = usuarios[id]?.companero;

    if (companeroId) {
        try {
            // Check that partner still exists and is not banned
            if (!usuarios[companeroId] || usuariosBaneados.has(companeroId)) {
                usuarios[id].companero = null;
                await bot.sendMessage(id, "Your partner is no longer available. The chat has ended.");
                return;
            }
            
            // Forward the message
            await bot.copyMessage(companeroId, id, msg.message_id);
            console.log(`📤 Message forwarded from ${id} to ${companeroId}`);
        } catch (error) {
            console.error(`Error sending message between users ${id} and ${companeroId}:`, error);
            
            try {
                await bot.sendMessage(id, mensajes.error_envio);
                if (usuarios[id]) usuarios[id].companero = null;
                if (usuarios[companeroId]) usuarios[companeroId].companero = null;
            } catch (fallbackError) {
                console.error(`Critical error notifying send failure:`, fallbackError);
            }
        }
    } else {
        try {
            await bot.sendMessage(id, "You don't have an active partner. Use /start to find one.");
        } catch (error) {
            console.error(`Error sending suggestion:`, error);
        }
    }
});

// IMPROVED PERIODIC CLEANUP
setInterval(() => {
    // Clean waiting queue of non-existent users
    for (let i = usuariosEnEspera.length - 1; i >= 0; i--) {
        const userId = usuariosEnEspera[i];
        if (!usuarios[userId] || usuariosBaneados.has(userId)) {
            usuariosEnEspera.splice(i, 1);
            console.log(`Cleaned user ${userId} from waiting queue`);
        }
    }
    
    // Clean orphaned connections
    for (const userId in usuarios) {
        const companeroId = usuarios[userId].companero;
        if (companeroId && (!usuarios[companeroId] || usuarios[companeroId].companero !== parseInt(userId))) {
            usuarios[userId].companero = null;
            console.log(`Cleaned orphaned connection for user ${userId}`);
        }
    }
}, 300000); // Every 5 minutes

console.log('🤖 Bot started successfully ✅');
console.log('📁 Token loaded from: token.env');
console.log(`👤 Admin ID: ${adminId}`);