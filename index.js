const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadContentFromMessage
} = require("@whiskeysockets/baileys");

const P = require("pino");
const qrcode = require("qrcode-terminal");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const config = require("./config");

const PREFIX = config.prefixo;

const TEMP_DIR = path.join(__dirname, "temp");
const AUTH_DIR = path.join(__dirname, "auth");

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
}

function log(text) {
    console.log(`[BOT] ${text}`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getSender(message) {
    return (
        message.key.participant ||
        message.key.remoteJid ||
        ""
    ).split(":")[0];
}

function isGroup(jid) {
    return jid.endsWith("@g.us");
}

function isOwner(jid) {
    const numero = jid.split("@")[0].split(":")[0];

    return numero === String(config.dono).replace(/\D/g, "");
}

function getMessageType(message) {
    if (!message) return null;

    if (message.imageMessage) return "image";
    if (message.videoMessage) return "video";
    if (message.documentMessage) return "document";

    return null;
}

async function baixarMidia(message, tipo) {
    const stream = await downloadContentFromMessage(
        message,
        tipo
    );

    const chunks = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

async function criarFigurinhaImagem(buffer) {
    return await sharp(buffer)
        .resize(512, 512, {
            fit: "contain",
            background: {
                r: 0,
                g: 0,
                b: 0,
                alpha: 0
            }
        })
        .webp({
            quality: 90
        })
        .toBuffer();
}

function executarFFmpeg(args) {
    return new Promise((resolve, reject) => {
        execFile(
            "ffmpeg",
            args,
            {
                windowsHide: true
            },
            (error, stdout, stderr) => {
                if (error) {
                    console.error(stderr);
                    reject(error);
                    return;
                }

                resolve();
            }
        );
    });
}

async function criarFigurinhaAnimada(buffer, extensao = "mp4") {
    const id = `${Date.now()}_${Math.random()
        .toString(36)
        .substring(2, 8)}`;

    const entrada = path.join(
        TEMP_DIR,
        `${id}.${extensao}`
    );

    const saida = path.join(
        TEMP_DIR,
        `${id}.webp`
    );

    fs.writeFileSync(entrada, buffer);

    try {
        await executarFFmpeg([
            "-y",
            "-i",
            entrada,

            "-t",
            String(config.maxVideoSeconds),

            "-vf",
            "scale=512:512:force_original_aspect_ratio=decrease," +
            "pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0," +
            "fps=15",

            "-c:v",
            "libwebp",

            "-lossless",
            "0",

            "-q:v",
            "60",

            "-loop",
            "0",

            "-an",

            saida
        ]);

        return fs.readFileSync(saida);
    } finally {
        try {
            fs.unlinkSync(entrada);
        } catch {}

        try {
            fs.unlinkSync(saida);
        } catch {}
    }
}

async function enviarFigurinha(sock, jid, buffer) {
    await sock.sendMessage(
        jid,
        {
            sticker: buffer
        }
    );
}

async function responder(sock, jid, texto) {
    await sock.sendMessage(
        jid,
        {
            text: texto
        }
    );
}

async function menu(sock, jid) {
    const texto = `
╭━━━〔 🤖 BOT DE FIGURINHAS 〕━━━╮
┃
┃ 🖼️ /s
┃ ┗ Envie uma imagem com /s
┃
┃ 🎬 /s
┃ ┗ Responda um vídeo com /s
┃
┃ 🎞️ /sticker
┃ ┗ Cria uma figurinha
┃
┃ 📋 /menu
┃ ┗ Mostra este menu
┃
┃ ❤️ /ping
┃ ┗ Testa o bot
┃
┃ ℹ️ /info
┃ ┗ Informações do bot
┃
╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯

📌 Como usar:

1. Envie uma imagem.
2. Responda a imagem com:
   /s

Ou:

1. Responda um vídeo/GIF.
2. Digite:
   /s

🤖 ${config.nomeBot}
`;

    await responder(sock, jid, texto);
}

async function processarComando(sock, msg) {
    const jid = msg.key.remoteJid;

    if (!jid) return;

    const texto =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";

    const textoLimpo = texto.trim();

    if (!textoLimpo.startsWith(PREFIX)) {
        return;
    }

    const partes = textoLimpo
        .slice(PREFIX.length)
        .trim()
        .split(/\s+/);

    const comando = (partes.shift() || "")
        .toLowerCase();

    const sender = getSender(msg);

    if (comando === "menu" || comando === "help") {
        await menu(sock, jid);
        return;
    }

    if (comando === "ping") {
        await responder(
            sock,
            jid,
            "🏓 Pong!\n\n🤖 Bot funcionando normalmente."
        );
        return;
    }

    if (comando === "info") {
        await responder(
            sock,
            jid,
            `🤖 ${config.nomeBot}

📌 Bot de figurinhas para WhatsApp
🖼️ Imagens: SIM
🎬 Vídeos: SIM
🎞️ GIFs: SIM
🇧🇷 Português

👑 Dono: ${config.dono}`
        );

        return;
    }

    if (
        comando !== "s" &&
        comando !== "sticker" &&
        comando !== "figurinha"
    ) {
        return;
    }

    await responder(
        sock,
        jid,
        "⏳ Criando sua figurinha..."
    );

    try {
        const quoted =
            msg.message?.extendedTextMessage
                ?.contextInfo
                ?.quotedMessage;

        let alvo = quoted;

        if (!alvo) {
            alvo = msg.message;
        }

        if (!alvo) {
            await responder(
                sock,
                jid,
                "❌ Não encontrei nenhuma mídia."
            );
            return;
        }

        if (alvo.imageMessage) {
            const buffer = await baixarMidia(
                alvo.imageMessage,
                "image"
            );

            if (
                buffer.length >
                config.maxImageSizeMB * 1024 * 1024
            ) {
                await responder(
                    sock,
                    jid,
                    "❌ A imagem é muito grande."
                );
                return;
            }

            const sticker =
                await criarFigurinhaImagem(buffer);

            await enviarFigurinha(
                sock,
                jid,
                sticker
            );

            return;
        }

        if (alvo.videoMessage) {
            const buffer = await baixarMidia(
                alvo.videoMessage,
                "video"
            );

            const sticker =
                await criarFigurinhaAnimada(
                    buffer,
                    "mp4"
                );

            await enviarFigurinha(
                sock,
                jid,
                sticker
            );

            return;
        }

        await responder(
            sock,
            jid,
            `❌ Não encontrei uma imagem ou vídeo.

Envie uma imagem/vídeo ou responda uma mídia com:

${PREFIX}s`
        );

    } catch (error) {
        console.error(error);

        await responder(
            sock,
            jid,
            `❌ Não consegui criar a figurinha.

Verifique se o FFmpeg está instalado e tente novamente.`
        );
    }
}

async function iniciarBot() {
    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(AUTH_DIR);

    const sock = makeWASocket({
        auth: state,

        logger: P({
            level: "silent"
        }),

        printQRInTerminal: false,

        browser: [
            config.nomeBot,
            "Chrome",
            "1.0.0"
        ]
    });

    sock.ev.on(
        "creds.update",
        saveCreds
    );

    sock.ev.on(
        "connection.update",
        async update => {
            const {
                connection,
                lastDisconnect,
                qr
            } = update;

            if (qr) {
                console.clear();

                console.log(`
╔══════════════════════════════════╗
║      🤖 BOT DE FIGURINHAS        ║
╠══════════════════════════════════╣
║                                  ║
║  Escaneie o QR Code abaixo       ║
║  usando o WhatsApp.              ║
║                                  ║
╚══════════════════════════════════╝
`);

                qrcode.generate(
                    qr,
                    {
                        small: true
                    }
                );
            }

            if (connection === "open") {
                console.clear();

                log("✅ WhatsApp conectado!");
                log(`🤖 ${config.nomeBot}`);
                log(`📌 Prefixo: ${PREFIX}`);
                log("🖼️ Figurinhas de imagem: OK");
                log("🎬 Figurinhas animadas: OK");

                console.log("");
                console.log(
                    "Digite /menu no WhatsApp."
                );
            }

            if (connection === "close") {
                const statusCode =
                    lastDisconnect
                        ?.error
                        ?.output
                        ?.statusCode;

                const shouldReconnect =
                    statusCode !==
                    DisconnectReason.loggedOut;

                if (shouldReconnect) {
                    log(
                        "🔄 Conexão perdida. Reconectando..."
                    );

                    await sleep(3000);

                    iniciarBot();
                } else {
                    log(
                        "❌ WhatsApp desconectado."
                    );
                    log(
                        "Apague a pasta auth e conecte novamente."
                    );
                }
            }
        }
    );

    sock.ev.on(
        "messages.upsert",
        async ({ messages }) => {
            const msg = messages[0];

            if (!msg) return;

            if (msg.key.fromMe) return;

            try {
                await processarComando(
                    sock,
                    msg
                );
            } catch (error) {
                console.error(
                    "Erro ao processar mensagem:",
                    error
                );
            }
        }
    );
}

process.on(
    "uncaughtException",
    error => {
        console.error(
            "Erro não tratado:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {
        console.error(
            "Promise rejeitada:",
            error
        );
    }
);

iniciarBot();
