/**
 * eval-resume-analysis.js — offline validation harness for the résumé analyzer (Phase D of
 * docs/data-processing-modules-proposal.md). A DEV TOOL, not a shipped feature.
 *
 * It samples résumés from Resume_datasets.csv (the public résumé-classification corpus —
 * columns ID, Resume_str, Resume_html, Category) and runs each through the SAME analyzer the
 * app uses (services/resumeAnalyzer.extractResumeProfile), reporting extraction success rate,
 * average skills/experiences, and category coverage. Use it to sanity-check the analyzer
 * across résumé types after a prompt/model change.
 *
 * It makes REAL AI calls (one per sampled résumé), so keep --limit small. It does NOT touch
 * the database. --dry skips the AI and just verifies corpus loading + sampling.
 *
 * USAGE:
 *   node scripts/eval-resume-analysis.js --dry            # load + sample only (no AI, no cost)
 *   node scripts/eval-resume-analysis.js --limit 5        # analyze 5 résumés
 *   node scripts/eval-resume-analysis.js --category "HR"  # restrict to one category
 *   node scripts/eval-resume-analysis.js --scan 5000 --limit 8
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const aiClient = require('../services/aiClient');
const { extractResumeProfile } = require('../services/resumeAnalyzer');

const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const has = (name) => process.argv.includes(`--${name}`);

const LIMIT = Math.max(1, parseInt(arg('limit', '8'), 10) || 8);
const SCAN = Math.max(100, parseInt(arg('scan', '3000'), 10) || 3000); // rows read (bounds memory)
const ONLY_CATEGORY = arg('category', null);
const DRY = has('dry');
const CSV_PATH = path.join(__dirname, '..', 'Resume_datasets.csv');

// Sample up to LIMIT résumés, spread across the categories found in the first SCAN rows.
function loadSample() {
    if (!fs.existsSync(CSV_PATH)) throw new Error(`Resume_datasets.csv not found at ${CSV_PATH}`);
    const wb = XLSX.read(fs.readFileSync(CSV_PATH), { type: 'buffer', sheetRows: SCAN });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const cleaned = rows
        .map((r) => ({ id: r.ID, text: String(r.Resume_str || '').trim(), category: String(r.Category || 'Uncategorized').trim() }))
        .filter((r) => r.text.length > 50 && (!ONLY_CATEGORY || r.category.toLowerCase() === ONLY_CATEGORY.toLowerCase()));

    const byCat = {};
    for (const r of cleaned) (byCat[r.category] = byCat[r.category] || []).push(r);
    const cats = Object.keys(byCat);
    const sample = [];
    let ci = 0;
    while (sample.length < LIMIT && cats.some((c) => byCat[c].length)) {
        const c = cats[ci % cats.length]; ci += 1;
        if (byCat[c].length) sample.push(byCat[c].shift());
    }
    return { sample: sample.slice(0, LIMIT), scanned: rows.length, categories: cats };
}

(async () => {
    const { sample, scanned, categories } = loadSample();
    console.log(`Résumé-analysis harness — ${sample.length} sampled from the first ${scanned} rows of ` +
        `Resume_datasets.csv${ONLY_CATEGORY ? ` (category=${ONLY_CATEGORY})` : ''}. Categories in scan: ${categories.length}.\n`);

    if (DRY) {
        for (const r of sample) console.log(`  [dry] #${r.id} (${r.category}) — ${r.text.length} chars`);
        console.log('\nDRY RUN — corpus loaded + sampled OK. Re-run without --dry to analyze (uses AI).');
        process.exit(0);
    }

    if (!aiClient.isAiConfigured()) {
        console.error('No AI provider configured (set OPENROUTER_API_KEY or DEEPSEEK_API_KEY). Use --dry to test loading only.');
        process.exit(1);
    }

    let ok = 0, fail = 0, totSkills = 0, totExp = 0;
    const catCov = {};
    for (const r of sample) {
        const t0 = Date.now();
        try {
            const { extracted } = await extractResumeProfile(r.text, { userId: 'eval' });
            const nSkills = (extracted.skills || []).length;
            const nExp = (extracted.experiences || []).length;
            const good = nSkills > 0 || nExp > 0;
            if (good) ok += 1; else fail += 1;
            totSkills += nSkills; totExp += nExp;
            catCov[r.category] = (catCov[r.category] || 0) + 1;
            console.log(`  [${good ? 'OK  ' : 'WARN'}] #${r.id} (${r.category}) — ${nSkills} skills, ${nExp} experiences, ${Date.now() - t0}ms`);
        } catch (e) {
            fail += 1;
            console.log(`  [FAIL] #${r.id} (${r.category}) — ${e.message}`);
        }
    }
    const n = sample.length || 1;
    console.log(`\nSummary: ${ok}/${sample.length} produced a usable extraction (${Math.round((ok / n) * 100)}%).`);
    console.log(`Averages: ${(totSkills / n).toFixed(1)} skills, ${(totExp / n).toFixed(1)} experiences per résumé.`);
    console.log(`Categories covered: ${Object.entries(catCov).map(([c, k]) => `${c}(${k})`).join(', ') || 'none'}.`);
    process.exit(fail > ok ? 1 : 0);
})().catch((e) => { console.error('[eval-resume] fatal:', e.message); process.exit(1); });
