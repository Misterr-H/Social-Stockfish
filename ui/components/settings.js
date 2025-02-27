import { StorageService } from '../../services/storage.js';

export class SettingsUI {
    constructor() {
        this.modal = document.getElementById('settingsModal');
        this.settingsBtn = document.getElementById('settingsBtn');
        this.closeBtn = document.getElementById('closeSettings');
        this.saveBtn = document.getElementById('saveSettings');
        this.llmSelect = document.getElementById('llmSelect');
        this.claudeApiKey = document.getElementById('claudeApiKey');
        this.gpt4ApiKey = document.getElementById('gpt4ApiKey');
        this.simulationToggle = document.getElementById('simulationToggle');

        this.initializeEventListeners();
        this.loadSettings();
    }

    async loadSettings() {
        const settings = await StorageService.getSettings();
        this.llmSelect.value = settings.selectedLLM;
        this.claudeApiKey.value = settings.claudeApiKey;
        this.gpt4ApiKey.value = settings.gpt4ApiKey;
        this.simulationToggle.checked = settings.simulationEnabled ?? true;
    }

    initializeEventListeners() {
        this.settingsBtn.onclick = () => this.modal.style.display = 'block';
        this.closeBtn.onclick = () => this.modal.style.display = 'none';
        this.saveBtn.onclick = async () => {
            await StorageService.saveSettings({
                selectedLLM: this.llmSelect.value,
                claudeApiKey: this.claudeApiKey.value,
                gpt4ApiKey: this.gpt4ApiKey.value,
                simulationEnabled: this.simulationToggle.checked
            });
            this.modal.style.display = 'none';
        };
    }
} 