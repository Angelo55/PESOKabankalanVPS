import React from 'react';
import { CheckSquare } from 'lucide-react';

/**
 * Checkbox overlay for a selectable card — shared by Saved Vacancies, My Applications,
 * the ATS and the admin grids.
 *
 * NOTE (2026-08-07 UI consolidation): the old delete-only `SelectionBar` toolbar that
 * used to live here was RETIRED. Both Saved Vacancies and My Applications now render the
 * shared `BulkActionBar` (+ `BulkDeleteButton`) from `common/AdminUI` — one Bulk Actions
 * design language across the whole system. Only this `SelectCheckbox` remains here; do
 * NOT reintroduce a second toolbar component.
 *
 * Visibility rules, deliberately different from the hover-revealed card controls: once
 * select mode is on, or the card is selected, the box is ALWAYS visible on every device.
 * Only the idle desktop affordance is hover-revealed (`reveal-on-hover`), and touch never
 * relies on it because long-press is the entry gesture there.
 */
export const SelectCheckbox = ({ checked, selectMode, onToggle, className = '' }) => (
    <button
        type="button"
        role="checkbox"
        aria-checked={!!checked}
        aria-label={checked ? 'Deselect item' : 'Select item'}
        onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
        onMouseDown={(e) => e.stopPropagation()}
        className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            checked
                ? 'bg-accent border-accent text-white'
                : 'bg-surface/90 dark:bg-gray-900/80 border-line hover:border-accent'
        } ${selectMode || checked ? '' : 'hidden sm:flex reveal-on-hover'} ${className}`}
    >
        {checked && <CheckSquare size={14} className="scale-110" />}
    </button>
);
