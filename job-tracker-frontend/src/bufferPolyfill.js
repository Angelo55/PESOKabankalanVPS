// Browser polyfill for Node's `Buffer` global. @react-pdf/renderer uses Buffer
// internally when decoding an embedded image (e.g. a résumé photo base64 <Image>),
// and Vite does NOT polyfill Node globals — without this, exporting a résumé that
// has a photo throws "Buffer is not defined". Imported FIRST in main.jsx so the
// global is set before any (lazy) module that touches react-pdf runs.
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') {
	globalThis.Buffer = Buffer;
}
