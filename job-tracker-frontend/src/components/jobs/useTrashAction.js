import { useState } from 'react';
import API from '../../api';
import { useNotification } from '../../context/NotificationContext';

/**
 * The confirm → soft-delete → toast-with-Undo flow, shared by Saved Vacancies
 * and My Applications.
 *
 * IMPORTANT — why the delete is committed BEFORE the toast, not after it
 * expires: holding the delete client-side until the countdown ends loses the
 * operation entirely if the tab closes or the user navigates away, leaving the
 * UI and the database disagreeing. Instead the row is soft-deleted immediately
 * (Trash becomes the durable end state) and "Undo" restores it. The observable
 * behaviour matches the brief — nothing is permanently deleted, Undo puts it
 * back, inaction leaves it in Trash — but it survives a closed tab.
 *
 * @param type   'saved-jobs' | 'applications' — the /api/trash route segment
 * @param nouns  { singular, plural } used for BOTH the dialog and the toast
 * @param onDone callback to refresh the page's list after any state change
 */
export default function useTrashAction({ type, nouns, onDone }) {
    const { notify, confirm } = useNotification();
    const [busy, setBusy] = useState(false);

    const label = (n) => (n === 1 ? nouns.singular : nouns.plural);

    const moveToTrash = async (ids) => {
        if (!ids?.length) return false;

        const noun = label(ids.length);
        const ok = await confirm(
            `Delete Selected ${noun}?`,
            ids.length === 1
                ? `This ${nouns.singular.toLowerCase()} will be moved to Trash. You can restore it within 7 days.`
                : `These ${ids.length} ${nouns.plural.toLowerCase()} will be moved to Trash. You can restore them within 7 days.`
        );
        if (!ok) return false;

        setBusy(true);
        try {
            await API.post(`/trash/${type}`, { ids });
            onDone?.();

            notify.action(
                `Selected ${noun} moved to Trash`,
                'Items stay in Trash for 7 days before they are removed for good.',
                {
                    label: 'Undo',
                    onClick: async () => {
                        try {
                            await API.post(`/trash/${type}/restore`, { ids });
                            onDone?.();
                            notify.success('Restored', `${noun} returned to their original place.`);
                        } catch (e) {
                            notify.error('Undo failed', 'The items are still in Trash — restore them from there.');
                        }
                    },
                }
            );
            return true;
        } catch (error) {
            notify.error('Delete failed', 'Nothing was removed. Please try again.');
            return false;
        } finally {
            setBusy(false);
        }
    };

    return { moveToTrash, busy };
}
