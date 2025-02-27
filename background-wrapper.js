// Import service worker code
import './service-worker.js';

// Log initialization
console.log('Background wrapper initialized');

// Re-export all functions from service worker
export * from './service-worker.js'; 