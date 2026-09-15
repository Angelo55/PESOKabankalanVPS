/**
 * aiTranslate — shared reply localization for the chatbots.
 *
 * Extracted verbatim from routes/chatbotRoutes.js (Phase A of the public
 * visitor-support chatbot, docs/public-visitor-chatbot-proposal.md) so BOTH the
 * authenticated Job-Seeker chatbot AND the public Landing-Page assistant localize
 * replies the SAME way — one implementation, no drift.
 *
 * The model is instructed to answer in English; this turns that English into the
 * user's language: DeepL for its supported languages, else an AI dialect pass
 * (Filipino/Cebuano/Ilocano/Hiligaynon), else the English text unchanged. It is
 * best-effort — any failure returns the English text rather than throwing.
 */
const axios = require('axios');
const aiClient = require('./aiClient');

const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_SUPPORTED_LANGS = ['BG', 'CS', 'DA', 'DE', 'EL', 'EN-GB', 'EN-US', 'ES', 'ET', 'FI', 'FR', 'HU', 'ID', 'IT', 'JA', 'KO', 'LT', 'LV', 'NB', 'NL', 'PL', 'PT-BR', 'PT-PT', 'RO', 'RU', 'SK', 'SL', 'SV', 'TR', 'UK', 'ZH'];

async function translateResponse(englishText, targetLang) {
    if (!targetLang || targetLang === 'en') return englishText;
    const langUpper = targetLang.toUpperCase();

    if (DEEPL_API_KEY && DEEPL_SUPPORTED_LANGS.includes(langUpper)) {
        try {
            const response = await axios.post('https://api-free.deepl.com/v2/translate', null, {
                params: { auth_key: DEEPL_API_KEY, text: englishText, target_lang: langUpper, preserve_formatting: 1 }
            });
            return response.data.translations[0].text;
        } catch (error) {
            console.error("DeepL Translation Error:", error.message);
        }
    }

    const languageMap = { 'fil': 'natural conversational Filipino (Tagalog/Taglish)', 'ceb': 'Cebuano dialect', 'ilo': 'Ilocano dialect', 'hil': 'Hiligaynon dialect' };
    const targetDialect = languageMap[targetLang] || targetLang;
    const prompt = `Translate the following platform assistance text into ${targetDialect}.
    CRITICAL: Maintain a polite and helpful tone. Do NOT literally translate technical UI terms. Text to translate: "${englishText}"`;

    try {
        const raw = await aiClient.chat({
            messages: [{ role: "user", content: prompt }],
            tier: aiClient.TIER.DRAFT,
            prefer: 'openrouter',
        });
        return raw.trim();
    } catch (error) {
        console.error("Dialect Translation Fallback Error:", error.message);
        return englishText;
    }
}

module.exports = { translateResponse };
