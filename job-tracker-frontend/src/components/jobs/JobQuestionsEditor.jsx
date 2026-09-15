import React from 'react';
import { Plus, Trash2, HelpCircle, GripVertical } from 'lucide-react';

// Preset browse categories (PESO admin picks one or types a custom value via the
// datalist on the job form). Kept here so the form and any future filters share
// a single source.
export const PRESET_CATEGORIES = [
    'Tech', 'Healthcare', 'Administration', 'Education', 'Skilled Trades',
    'Customer Service', 'Finance', 'Sales & Marketing', 'Hospitality', 'Other'
];

const QUESTION_TYPES = [
    { value: 'text', label: 'Short answer' },
    { value: 'textarea', label: 'Paragraph' },
    { value: 'select', label: 'Multiple choice' },
    { value: 'boolean', label: 'Yes / No' },
];

const emptyQuestion = () => ({ question_text: '', question_type: 'text', is_required: true, options: [] });

/**
 * Repeatable editor for a job's "Additional Questions". Controlled: the parent
 * owns the `questions` array and receives updates via `onChange`. Persisted by
 * the parent through PUT /peso-admin/jobs/:id/questions.
 */
const JobQuestionsEditor = ({ questions = [], onChange }) => {
    const update = (idx, patch) => {
        const next = questions.map((q, i) => (i === idx ? { ...q, ...patch } : q));
        onChange(next);
    };
    const add = () => onChange([...questions, emptyQuestion()]);
    const remove = (idx) => onChange(questions.filter((_, i) => i !== idx));

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted font-medium">
                Ask applicants job-specific questions. They must answer any marked required before they can submit.
            </p>

            {questions.length === 0 && (
                <div className="py-8 text-center border-2 border-dashed border-line rounded-2xl bg-surface/40 dark:bg-gray-900/30">
                    <HelpCircle size={28} className="mx-auto text-subtle mb-2" />
                    <p className="text-sm font-medium text-muted">No additional questions yet.</p>
                </div>
            )}

            {questions.map((q, idx) => (
                <div key={idx} className="p-4 rounded-2xl bg-surface/50 dark:bg-gray-900/50 border border-white/40 dark:border-line space-y-3">
                    <div className="flex items-start gap-2">
                        <GripVertical size={18} className="text-subtle mt-2.5 shrink-0" />
                        <input
                            type="text"
                            value={q.question_text}
                            onChange={(e) => update(idx, { question_text: e.target.value })}
                            placeholder={`Question ${idx + 1}`}
                            className="flex-1 p-3 rounded-xl bg-surface/70 border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/40 font-medium text-content text-sm"
                        />
                        <button type="button" onClick={() => remove(idx)} className="p-2.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-xl transition-colors shrink-0" title="Remove question">
                            <Trash2 size={16} />
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 pl-7">
                        <select
                            value={q.question_type}
                            onChange={(e) => update(idx, { question_type: e.target.value })}
                            className="p-2.5 rounded-xl bg-surface/70 border border-white/40 dark:border-line outline-none font-bold text-sm text-muted cursor-pointer"
                        >
                            {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>

                        <label className="flex items-center gap-2 text-sm font-bold text-muted cursor-pointer select-none">
                            <input type="checkbox" checked={q.is_required !== false} onChange={(e) => update(idx, { is_required: e.target.checked })} className="w-4 h-4 accent-[#1a4a38]" />
                            Required
                        </label>

                        {q.question_type === 'select' && (
                            <input
                                type="text"
                                value={Array.isArray(q.options) ? q.options.join(', ') : ''}
                                onChange={(e) => update(idx, { options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) })}
                                placeholder="Choices, comma separated (e.g. Yes, No, Maybe)"
                                className="flex-1 min-w-[200px] p-2.5 rounded-xl bg-surface/70 border border-white/40 dark:border-line outline-none focus:ring-2 focus:ring-accent/40 font-medium text-content text-sm"
                            />
                        )}
                    </div>
                </div>
            ))}

            <button type="button" onClick={add} className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-bold rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors text-sm">
                <Plus size={16} /> Add Question
            </button>
        </div>
    );
};

export default JobQuestionsEditor;
