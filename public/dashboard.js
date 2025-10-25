// Complete Dashboard JavaScript with Auto Logout
class VerdantDashboard {
    constructor() {
        this.API_BASE = '/api/admin';
        this.selectedKeys = new Set();
        this.charts = {};
        this.filteredKeys = [];
        this.logoutTimer = null;
        this.initialize();
    }

    initialize() {
        this.checkAuth();
        this.setupEventListeners();
        this.setupAutoLogout();
        this.loadDashboardData();
        this.setupCharts();
        this.startRealTimeUpdates();
    }

    async checkAuth() {
        try {
            const response = await fetch('/api/session');
            const result = await response.json();
            
            if (!result.success) {
                window.location.href = '/';
                return;
            }
            
            // Update username in navbar
            const usernameElement = document.getElementById('navbar-username');
            if (usernameElement && result.user) {
                usernameElement.textContent = result.user.username;
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            window.location.href = '/';
        }
    }

    setupAutoLogout() {
        // Reset timer on user activity
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
        const resetTimer = () => {
            this.resetLogoutTimer();
        };

        events.forEach(event => {
            document.addEventListener(event, resetTimer);
        });

        this.resetLogoutTimer();
    }

    resetLogoutTimer() {
        if (this.logoutTimer) {
            clearTimeout(this.logoutTimer);
        }

        // Set timer for 30 minutes (1800000 ms)
        this.logoutTimer = setTimeout(() => {
            this.autoLogout();
        }, 30 * 60 * 1000);
    }

    async autoLogout() {
        try {
            await fetch('/api/logout');
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            window.location.href = '/';
        }
    }

    async logout() {
        try {
            const response = await fetch('/api/logout');
            const result = await response.json();
            
            if (result.success) {
                window.location.href = '/';
            }
        } catch (error) {
            console.error('Logout error:', error);
            window.location.href = '/';
        }
    }

    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('[data-tab]').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchTab(tab.getAttribute('data-tab'));
            });
        });

        // Logout button
        const logoutBtn = document.querySelector('a[href="/api/logout"]');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.logout();
            });
        }

        // Generate key forms
        document.getElementById('quickGenerateForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.generateKey();
        });

        // Filter events
        document.getElementById('filter-status')?.addEventListener('change', () => this.filterKeys());
        document.getElementById('filter-devices')?.addEventListener('change', () => this.filterKeys());
        document.getElementById('filter-search')?.addEventListener('input', () => this.filterKeys());

        // Bulk selection
        document.getElementById('select-all')?.addEventListener('change', (e) => {
            this.toggleSelectAll(e.target.checked);
        });
    }

    switchTab(tabName) {
        // Update active nav link
        document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
        const activeLink = document.querySelector(`[data-tab="${tabName}"]`);
        if (activeLink) activeLink.classList.add('active');

        // Show corresponding tab content
        document.querySelectorAll('.tab-pane').forEach(pane => pane.style.display = 'none');
        const targetTab = document.getElementById(`${tabName}-tab`);
        if (targetTab) targetTab.style.display = 'block';

        // Load tab-specific data
        switch(tabName) {
            case 'dashboard':
                this.loadDashboardData();
                break;
            case 'manage':
                this.loadKeys();
                break;
            case 'generate':
                this.loadRecentGenerated();
                break;
            case 'analytics':
                this.loadAnalytics();
                break;
        }
    }

    async loadDashboardData() {
        try {
            const response = await fetch('/api/admin/stats');
            const result = await response.json();

            if (result.success) {
                this.updateStats(result.stats);
                this.updateActivity(result.activity);
            }
        } catch (error) {
            console.error('Error loading dashboard data:', error);
        }
    }

    async loadKeys() {
        const loading = document.getElementById('keys-loading');
        const tbody = document.getElementById('keys-tbody');
        
        if (loading) loading.style.display = 'block';
        if (tbody) tbody.innerHTML = '';

        try {
            const response = await fetch('/api/admin/keys');
            const result = await response.json();
            
            if (result.success) {
                this.filteredKeys = result.keys;
                this.renderKeysTable(result.keys);
                this.updateStats(result.stats);
            }
        } catch (error) {
            console.error('Error loading keys:', error);
            this.showNotification('Error loading keys', 'error');
        } finally {
            if (loading) loading.style.display = 'none';
        }
    }

    renderKeysTable(keys) {
        const tbody = document.getElementById('keys-tbody');
        if (!tbody) return;

        tbody.innerHTML = '';

        if (keys.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="10" class="text-center py-4 text-muted">
                        <i class="bi bi-inbox fs-1 d-block mb-2"></i>
                        No license keys found. Generate your first key!
                    </td>
                </tr>
            `;
            return;
        }

        keys.forEach(key => {
            const status = this.getKeyStatus(key);
            const statusClass = this.getStatusClass(status);
            const isSelected = this.selectedKeys.has(key.key);
            const isExpired = new Date(key.expiration_date) < new Date();

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <input class="form-check-input row-select" type="checkbox" 
                           data-key="${key.key}" ${isSelected ? 'checked' : ''}>
                </td>
                <td>
                    <div class="d-flex align-items-center">
                        <div class="avatar-sm bg-primary rounded-circle d-flex align-items-center justify-content-center me-2">
                            <i class="bi bi-person text-white small"></i>
                        </div>
                        ${key.used_by || 'N/A'}
                    </div>
                </td>
                <td>
                    <code class="text-warning cursor-pointer" onclick="copyToClipboard('${key.key}')">
                        ${key.key}
                    </code>
                </td>
                <td>${this.formatDate(key.created_at)}</td>
                <td>
                    <span class="${isExpired ? 'text-danger' : 'text-success'}">
                        ${key.expiration_date}
                    </span>
                </td>
                <td>
                    <span class="badge bg-dark">${key.used ? '1/1' : '0/1'}</span>
                </td>
                <td>
                    <span class="badge ${statusClass}">${status.toUpperCase()}</span>
                </td>
                <td>${key.used ? 1 : 0}</td>
                <td>${key.used_at ? this.formatDate(key.used_at) : 'Never'}</td>
                <td>
                    <div class="btn-group btn-group-sm">
                        <button class="btn btn-outline-warning" onclick="showExtendModal('${key.key}', '${key.expiration_date}')" title="Extend" ${!key.isActive ? 'disabled' : ''}>
                            <i class="bi bi-calendar-plus"></i>
                        </button>
                        <button class="btn btn-outline-info" onclick="showDevicesModal('${key.key}', 1)" title="Devices">
                            <i class="bi bi-phone"></i>
                        </button>
                        <button class="btn btn-outline-danger" onclick="showDeleteModal('${key.key}')" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                        <button class="btn btn-outline-secondary" onclick="copyToClipboard('${key.key}')" title="Copy">
                            <i class="bi bi-copy"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });

        this.setupTableInteractions();
    }

    setupTableInteractions() {
        // Row selection
        document.querySelectorAll('.row-select').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const key = e.target.getAttribute('data-key');
                if (e.target.checked) {
                    this.selectedKeys.add(key);
                } else {
                    this.selectedKeys.delete(key);
                }
                this.updateBulkActions();
            });
        });

        // Search and filter
        this.setupFilters();
    }

    setupFilters() {
        let timeout;
        const searchInput = document.getElementById('filter-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => this.filterKeys(), 300);
            });
        }
    }

    filterKeys() {
        const statusFilter = document.getElementById('filter-status')?.value || 'all';
        const devicesFilter = document.getElementById('filter-devices')?.value || 'all';
        const searchFilter = document.getElementById('filter-search')?.value.toLowerCase() || '';

        document.querySelectorAll('#keys-tbody tr').forEach(row => {
            const statusBadge = row.querySelector('.badge');
            const status = statusBadge ? statusBadge.textContent.toLowerCase() : '';
            const devicesText = row.cells[5].textContent;
            const keyText = row.cells[2].textContent.toLowerCase();
            const userText = row.cells[1].textContent.toLowerCase();

            const statusMatch = statusFilter === 'all' || status.includes(statusFilter);
            const devicesMatch = devicesFilter === 'all' || 
                (devicesFilter === 'used' && !devicesText.includes('0/')) ||
                (devicesFilter === 'unused' && devicesText.includes('0/'));
            const searchMatch = !searchFilter || 
                keyText.includes(searchFilter) || 
                userText.includes(searchFilter);

            row.style.display = statusMatch && devicesMatch && searchMatch ? '' : 'none';
        });
    }

    toggleSelectAll(selected) {
        document.querySelectorAll('.row-select').forEach(checkbox => {
            checkbox.checked = selected;
            const key = checkbox.getAttribute('data-key');
            if (selected) {
                this.selectedKeys.add(key);
            } else {
                this.selectedKeys.delete(key);
            }
        });
        this.updateBulkActions();
    }

    updateBulkActions() {
        const bulkActions = document.getElementById('bulk-actions');
        const selectedCount = document.getElementById('selected-count');
        
        if (bulkActions && selectedCount) {
            if (this.selectedKeys.size > 0) {
                bulkActions.style.display = 'block';
                selectedCount.textContent = `${this.selectedKeys.size} keys selected`;
            } else {
                bulkActions.style.display = 'none';
            }
        }
    }

    async generateKey() {
        const formData = {
            username: document.getElementById('gen-username').value,
            duration_type: document.getElementById('gen-unit').value,
            duration_value: parseInt(document.getElementById('gen-duration').value),
            max_devices: parseInt(document.getElementById('gen-max-devices').value),
            type: 'custom'
        };

        if (formData.duration_type === 'days') {
            formData.days = formData.duration_value;
        }

        try {
            const response = await fetch('/api/admin/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification(`✅ Generated ${result.keys.length} key(s) successfully`, 'success');
                this.addRecentGenerated(result.keys[0].key, formData.username);
                document.getElementById('quickGenerateForm').reset();
                this.loadDashboardData();
            } else {
                this.showNotification(`❌ ${result.message}`, 'error');
            }
        } catch (error) {
            this.showNotification('❌ Error generating key', 'error');
        }
    }

    async revokeKey(licenseKey) {
        if (!confirm('Are you sure you want to revoke this license key?')) return;

        try {
            const response = await fetch('/api/admin/revoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: licenseKey })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification('✅ Key revoked successfully', 'success');
                this.loadKeys();
                this.loadDashboardData();
            } else {
                this.showNotification(`❌ ${result.message}`, 'error');
            }
        } catch (error) {
            this.showNotification('❌ Error revoking key', 'error');
        }
    }

    async deleteKey(licenseKey) {
        if (!confirm('Are you sure you want to permanently delete this license key? This action cannot be undone.')) return;

        try {
            const response = await fetch(`/api/admin/keys/${licenseKey}`, {
                method: 'DELETE'
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.showNotification('✅ Key deleted successfully', 'success');
                this.loadKeys();
                this.loadDashboardData();
            } else {
                this.showNotification(`❌ ${result.message}`, 'error');
            }
        } catch (error) {
            this.showNotification('❌ Error deleting key', 'error');
        }
    }

    setupCharts() {
        // Usage Chart
        const usageCtx = document.getElementById('usageChart');
        if (usageCtx) {
            this.charts.usage = new Chart(usageCtx.getContext('2d'), {
                type: 'line',
                data: {
                    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                    datasets: [{
                        label: 'Keys Generated',
                        data: [12, 19, 3, 5, 2, 3, 7],
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        tension: 0.4,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            labels: { color: '#94a3b8' }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255,255,255,0.1)' },
                            ticks: { color: '#94a3b8' }
                        },
                        y: {
                            grid: { color: 'rgba(255,255,255,0.1)' },
                            ticks: { color: '#94a3b8' }
                        }
                    }
                }
            });
        }

        // Device Chart
        const deviceCtx = document.getElementById('deviceChart');
        if (deviceCtx) {
            this.charts.device = new Chart(deviceCtx.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: ['Active', 'Expired', 'Revoked'],
                    datasets: [{
                        data: [65, 25, 10],
                        backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: '#94a3b8' }
                        }
                    }
                }
            });
        }
    }

    updateStats(stats) {
        if (stats) {
            if (document.getElementById('stats-total')) 
                document.getElementById('stats-total').textContent = stats.total_generated.toLocaleString();
            
            if (document.getElementById('stats-active')) 
                document.getElementById('stats-active').textContent = stats.active_keys.toLocaleString();
            
            if (document.getElementById('stats-expired')) {
                const expired = stats.total_generated - stats.active_keys - stats.revoked_keys;
                document.getElementById('stats-expired').textContent = expired.toLocaleString();
            }
            
            if (document.getElementById('stats-revenue')) 
                document.getElementById('stats-revenue').textContent = `$${(stats.total_generated * 10).toLocaleString()}`;
            
            // Update chart data
            if (this.charts.device) {
                const active = stats.active_keys;
                const expired = stats.total_generated - stats.active_keys - stats.revoked_keys;
                const revoked = stats.revoked_keys;
                
                this.charts.device.data.datasets[0].data = [active, expired, revoked];
                this.charts.device.update();
            }
        }
    }

    updateActivity(activity) {
        const container = document.getElementById('recent-activity');
        if (container && activity) {
            container.innerHTML = activity.map(item => `
                <div class="activity-item">
                    <div class="d-flex justify-content-between">
                        <strong class="text-light">${this.escapeHtml(item.action)}</strong>
                        <small class="text-muted">${this.formatTime(item.created_at)}</small>
                    </div>
                    <p class="text-muted mb-0 small">${this.escapeHtml(item.details)}</p>
                    ${item.license_key ? `<small class="text-info">Key: ${item.license_key}</small>` : ''}
                </div>
            `).join('');
        }
    }

    addRecentGenerated(licenseKey, username) {
        const container = document.getElementById('recent-generated');
        if (container) {
            const item = document.createElement('div');
            item.className = 'mb-3 p-3 bg-dark rounded';
            item.innerHTML = `
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <strong class="d-block">${this.escapeHtml(username)}</strong>
                        <code class="text-warning small">${licenseKey}</code>
                        <div class="mt-1">
                            <small class="text-muted">Generated just now</small>
                        </div>
                    </div>
                    <button class="btn btn-sm btn-outline-secondary" onclick="copyToClipboard('${licenseKey}')">
                        <i class="bi bi-copy"></i>
                    </button>
                </div>
            `;
            container.insertBefore(item, container.firstChild);

            // Keep only 5 items
            while (container.children.length > 5) {
                container.removeChild(container.lastChild);
            }
        }
    }

    loadRecentGenerated() {
        this.loadKeys().then(() => {
            const container = document.getElementById('recent-generated');
            if (container) {
                const recentKeys = this.filteredKeys.slice(0, 5);
                if (recentKeys.length === 0) {
                    container.innerHTML = `
                        <div class="text-center text-muted py-4">
                            <i class="bi bi-key fs-1 d-block mb-2"></i>
                            <small>No keys generated yet</small>
                        </div>
                    `;
                } else {
                    container.innerHTML = recentKeys.map(key => `
                        <div class="mb-3 p-3 bg-dark rounded">
                            <div class="d-flex justify-content-between align-items-start">
                                <div>
                                    <strong class="d-block">${key.used_by || 'N/A'}</strong>
                                    <code class="text-warning small">${key.key.substring(0, 16)}...</code>
                                    <div class="mt-1">
                                        <small class="text-muted">Expires: ${key.expiration_date}</small>
                                    </div>
                                </div>
                                <button class="btn btn-sm btn-outline-secondary" onclick="copyToClipboard('${key.key}')">
                                    <i class="bi bi-copy"></i>
                                </button>
                            </div>
                        </div>
                    `).join('');
                }
            }
        });
    }

    loadAnalytics() {
        this.loadDashboardData();
    }

    // Utility methods
    getKeyStatus(key) {
        if (!key.isActive) return 'revoked';
        if (new Date(key.expiration_date) < new Date()) return 'expired';
        if (key.used) return 'used';
        return 'active';
    }

    getStatusClass(status) {
        const classes = {
            active: 'bg-success',
            used: 'bg-warning',
            expired: 'bg-danger',
            revoked: 'bg-secondary'
        };
        return classes[status] || 'bg-secondary';
    }

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    formatTime(dateString) {
        return new Date(dateString).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `alert alert-${type} alert-dismissible fade show position-fixed`;
        notification.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
        notification.innerHTML = `
            ${message}
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="alert"></button>
        `;

        document.body.appendChild(notification);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }

    startRealTimeUpdates() {
        // Update dashboard every 30 seconds
        setInterval(() => {
            this.loadDashboardData();
        }, 30000);
    }
}

// Global functions
function showGenerateModal() {
    window.dashboard.showNotification('Use the quick generation form or implement modal logic', 'info');
}

function showExtendModal(licenseKey, currentExpires) {
    window.dashboard.showNotification('Extend feature coming soon!', 'info');
}

function showDevicesModal(licenseKey, currentDevices) {
    window.dashboard.showNotification('Devices feature coming soon!', 'info');
}

function showDeleteModal(licenseKey) {
    if (confirm('Are you sure you want to delete this license key? This action cannot be undone.')) {
        window.dashboard.deleteKey(licenseKey);
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        if (window.dashboard) {
            window.dashboard.showNotification('✅ Copied to clipboard!', 'success');
        }
    });
}

function exportData() {
    window.dashboard.showNotification('📊 Export feature coming soon!', 'info');
}

function showBulkModal() {
    window.dashboard.showNotification('🔢 Bulk generation coming soon!', 'info');
}

function showAnalytics() {
    window.dashboard.switchTab('analytics');
}

function bulkRevoke() {
    window.dashboard.showNotification('🔄 Bulk revoke coming soon!', 'warning');
}

function bulkExtend() {
    window.dashboard.showNotification('📅 Bulk extend coming soon!', 'info');
}

function clearSelection() {
    window.dashboard.toggleSelectAll(false);
}

function refreshKeys() {
    window.dashboard.loadKeys();
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new VerdantDashboard();
});