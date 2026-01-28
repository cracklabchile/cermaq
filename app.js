/**
 * CONFIGURATION
 */
const CONFIG = {
    // Default API URL from user
    DEFAULT_API: 'https://script.google.com/macros/s/AKfycbzpgUkMhdDmLSaejzg_Faql7j-fpojIx0mx98w1sQzl9Wdbfjx1YRdVZij9VLnF5sCK/exec',
    STORAGE_KEY: 'cermaq_inventory_url',
};

let html5QrcodeScanner = null;
let currentProduct = null;
let isScanning = false;
let isAdmin = false;
let allProductsCache = []; // For search

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    checkConnection();

    // Setup event listeners
    document.getElementById('btn-scan-start').addEventListener('click', startScanner);

    // Close modal on click outside (optional or keep simple)
    document.querySelector('.modal-backdrop').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
}

/**
 * API HANDLING
 */
function getApiUrl() {
    return localStorage.getItem(CONFIG.STORAGE_KEY) || CONFIG.DEFAULT_API;
}

async function checkConnection() {
    // Process queue on connect
    if (navigator.onLine) processQueue();

    updateStatus('connecting', 'Conectando...');
    try {
        const response = await fetch(getApiUrl());
        if (!response.ok) throw new Error("API Error");

        const data = await response.json();
        allProductsCache = data; // Cache for search

        // Update queue badge just in case
        const pending = JSON.parse(localStorage.getItem('pending_txs') || '[]');
        updatePendingBadge(pending.length);

        updateStatus('online', `Conectado (${data.length} productos)`);
        return true;
    } catch (error) {
        console.error(error);
        updateStatus('offline', 'Modo Offline');
        return false;
    }
}

async function fetchProduct(id) {
    showToast('Buscando producto...', 'info');
    try {
        const response = await fetch(getApiUrl());
        const data = await response.json();
        return data.find(p => String(p.id) === String(id));
    } catch (e) {
        showToast('Error de conexión', 'error');
        return null;
    }
}

async function sendTransaction(payload) {
    try {
        // IMPORTANT: We use standard CORS now, assuming standard setup.
        // If Google Script needs it, we can use 'no-cors' but we prefer response reading.
        // For best results with Google Apps Script Web App, use:
        // ContentService.createTextOutput(...).setMimeType(ContentService.MimeType.JSON);

        const response = await fetch(getApiUrl(), {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        // Google Apps Script redirects on success usually, catch that if possible
        const result = await response.json();
        return result;
    } catch (error) {
        console.error("Transacción error:", error);

        // OFFLINE HANDLING
        // If network fails, we queue it
        const pending = JSON.parse(localStorage.getItem('pending_txs') || '[]');
        pending.push({
            payload: payload,
            timestamp: new Date().getTime()
        });
        localStorage.setItem('pending_txs', JSON.stringify(pending));

        updatePendingBadge(pending.length);

        return { status: "offline", message: "Guardado sin conexión" };
    }
}

// Sync Logic
async function processQueue() {
    const pending = JSON.parse(localStorage.getItem('pending_txs') || '[]');
    if (pending.length === 0) return;

    // Try to send one by one
    const newPending = [];
    let processed = 0;

    updateStatus('connecting', 'Sincronizando...');

    for (const item of pending) {
        try {
            // We bypass sendTransaction to avoid double queuing
            const response = await fetch(getApiUrl(), {
                method: 'POST',
                body: JSON.stringify(item.payload)
            });
            if (response.ok) {
                processed++;
            } else {
                newPending.push(item);
            }
        } catch (e) {
            newPending.push(item);
        }
    }

    localStorage.setItem('pending_txs', JSON.stringify(newPending));
    updatePendingBadge(newPending.length);

    if (processed > 0) {
        showToast(`Sincronizados ${processed} movimientos`, 'success');
        checkConnection(); // Refresh stock
    }
}

// Auto-Sync loop
setInterval(processQueue, 30000); // Check every 30s

/**
 * UI LOGIC
 */
function updateStatus(state, text) {
    const dot = document.getElementById('status-dot');
    const label = document.getElementById('status-text');

    dot.className = 'dot'; // reset
    if (state === 'online') dot.classList.add('online');
    else if (state === 'error') dot.classList.add('error');

    label.innerText = text;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'info';
    if (type === 'success') icon = 'check_circle';
    if (type === 'error') icon = 'error';

    toast.innerHTML = `
        <span class="material-icons-round">${icon}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Remove after 3s
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

/**
 * SCANNER LOGIC
 */
function startScanner() {
    if (isScanning) return;

    document.querySelector('.scanner-wrapper').classList.add('active');
    document.querySelector('.scan-overlay').style.opacity = '0';
    document.getElementById('btn-scan-text').innerText = 'Escanear...';

    html5QrcodeScanner = new Html5Qrcode("reader");
    html5QrcodeScanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        onScanSuccess
    ).catch(err => {
        showToast("Error cámara: " + err, 'error');
    });

    isScanning = true;
}

function stopScanner() {
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            html5QrcodeScanner.clear();
            isScanning = false;
            document.querySelector('.scan-overlay').style.opacity = '1';
            document.getElementById('btn-scan-text').innerText = 'ESCANEAR';
        });
    }
}

let cart = [];

/**
 * CART SYSTEM
 */
function addToCart(type) {
    if (!currentProduct) return;

    const qty = parseInt(document.getElementById('qty-input').value);
    const id = currentProduct.id;
    const name = currentProduct.nombre;
    const comment = document.getElementById('tx-comment').value;
    const price = document.getElementById('tx-price').value;

    if (type === 'OUT') {
        const currentStock = parseInt(currentProduct.stock);
        if (qty > currentStock) {
            showToast(`Error: Stock insuficiente. Tienes ${currentStock}`, 'error');
            return;
        }
    }

    // Add to local state
    cart.push({
        id: id,
        name: name,
        type: type,
        qty: qty,
        timestamp: new Date(),
        comment: comment,
        price: price
    });

    updateCartBadge();
    closeModal();
    showToast(`${type === 'IN' ? 'Ingreso' : 'Salida'} agregado a la lista`, 'success');

    // Clear inputs
    document.getElementById('tx-comment').value = "";
    document.getElementById('tx-price').value = "";
}

function updateCartBadge() {
    const badge = document.getElementById('cart-badge');
    badge.innerText = cart.length;
    badge.style.display = cart.length > 0 ? 'block' : 'none';
}

function updatePendingBadge(count) {
    const badge = document.getElementById('status-dot');
    if (count > 0) {
        badge.classList.add('error'); // Red color
        document.getElementById('status-text').innerText = `Cola: ${count} items`;
    }
}

function openCartModal() {
    document.getElementById('modal-cart').classList.add('active');
    renderCart();
}

function renderCart() {
    const container = document.getElementById('cart-items-container');
    container.innerHTML = '';

    if (cart.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-light);">Tu lista está vacía.</div>';
        return;
    }

    cart.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'cart-item';
        div.innerHTML = `
            <div class="cart-item-info">
                <h4>${item.name}</h4>
                <p>ID: ${item.id} | Cantidad: <b>${item.qty}</b></p>
            </div>
            <div class="cart-item-action">
                <span class="tag ${item.type === 'IN' ? 'in' : 'out'}">${item.type}</span>
                <button class="icon-btn" onclick="removeFromCart(${index})">
                    <span class="material-icons-round" style="color: var(--danger)">delete</span>
                </button>
            </div>
        `;
        container.appendChild(div);
    });
}

function removeFromCart(index) {
    cart.splice(index, 1);
    updateCartBadge();
    renderCart();
}

async function processCart() {
    if (cart.length === 0) return;

    const btn = document.querySelector('#modal-cart .btn-primary');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="material-icons-round spin">sync</span> Procesando...';
    btn.disabled = true;

    let successCount = 0;
    let errors = [];

    // Process sequentially to avoid race conditions on the Sheet
    for (const item of cart) {
        try {
            const result = await sendTransaction({
                action: item.type,
                id: item.id,
                quantity: item.qty,
                user: "WebUser",
                comment: item.comment || "",
                price: item.price || ""
            });

            if (result.status === 'success') {
                successCount++;
            } else {
                errors.push(`${item.name}: ${result.message}`);
            }
        } catch (e) {
            errors.push(`${item.name}: Error de red`);
        }
    }

    // Done
    btn.innerHTML = originalText;
    btn.disabled = false;

    if (errors.length === 0) {
        showToast(`¡Éxito! ${successCount} movimientos procesados.`, 'success');
        cart = [];
        updateCartBadge();
        closeModal();
        checkConnection(); // Refresh global stock
    } else {
        alert(`Se procesaron ${successCount} ítems correctament, pero hubo errores:\n\n${errors.join('\n')}`);
        // Remove successful ones? For now, we keep cart for retry or manual clear
        // Ideally we filter out the successful ones from 'cart' here.
    }
}

// Replaces the old direct handleTransaction
function handleTransaction(type) {
    addToCart(type);
}

// Updated Scan Success with Vibration
function onScanSuccess(decodedText) {
    // Vibrate for feedback
    if (navigator.vibrate) navigator.vibrate(200);

    // Play sound if needed (User requested vibration only, so commented out)
    // const audio = new Audio('beep.mp3'); audio.play();

    stopScanner(); // Consider keeping it open for "Continuous Mode" later
    openProductModal(decodedText);
}

async function handleCreate() {
    const id = document.getElementById('new-id').value;
    const name = document.getElementById('new-name').value;
    const stock = document.getElementById('new-stock').value;

    // Admin can send empty ID for Auto
    if ((!id && !isAdmin) || !name) {
        showToast('Faltan datos obligatorios', 'error');
        return;
    }

    closeModal();
    showToast('Creando producto...', 'info');

    try {
        const result = await sendTransaction({
            action: 'ADD',
            id: id || "AUTO", // Support Auto-ID
            nombre: name,
            stock: stock,
            user: "WebAdmin"
        });

        if (result.status === 'success' || result.status === 'offline') {
            showToast(result.status === 'offline' ? 'Guardado offline' : 'Producto creado OK', 'success');
            checkConnection();
        } else {
            showToast('Error: ' + result.message, 'error');
        }
    } catch (e) {
        showToast('Error al crear producto', 'error');
    }
}

/**
 * LABEL MAKER LOGIC
 */
async function openLabelMaker() {
    document.getElementById('modal-labels').classList.add('active');
    const container = document.getElementById('label-container');
    container.innerHTML = '<div style="text-align: center; color: #94a3b8; grid-column: 1/-1;">Cargando inventario...</div>';

    try {
        const response = await fetch(getApiUrl());
        const products = await response.json();

        container.innerHTML = ''; // clear loading

        if (products.length === 0) {
            container.innerHTML = '<div style="text-align: center;">No hay productos.</div>';
            return;
        }

        products.forEach(p => {
            // Create Card
            const card = document.createElement('div');
            card.className = 'qr-label';

            // Generate content
            // We use a container for the QR to append it safely
            const qrContainer = document.createElement('div');
            qrContainer.className = 'qr-code-img';

            card.innerHTML = `
                <h3>${p.nombre}</h3>
            `;
            card.appendChild(qrContainer);
            card.innerHTML += `
                <div class="qr-id">ID: ${p.id}</div>
            `;

            // Generate QR using CLIENT-SIDE LIB (Infinite & Dynamic)
            const qrDiv = document.createElement('div');
            qrDiv.id = `qr-gen-${p.id}`;
            qrDiv.className = "qr-div"; // styling hook

            qrContainer.appendChild(qrDiv);
            container.appendChild(card);

            // Generate immediately
            setTimeout(() => {
                new QRCode(qrDiv, {
                    text: String(p.id),
                    width: 128,
                    height: 128,
                    colorDark: "#000000",
                    colorLight: "#ffffff",
                    correctLevel: QRCode.CorrectLevel.H
                });
            }, 10);

            // Allow selection
            card.onclick = function () {
                this.classList.toggle('selected');
                updatePrintButton();
            }
        });

        // Add Print Selected Button
        const btnPrint = document.createElement('button');
        btnPrint.id = "btn-print-labels";
        btnPrint.className = "btn btn-primary no-print";
        btnPrint.style.marginTop = "1rem";
        btnPrint.style.width = "100%";
        btnPrint.innerHTML = '<span class="material-icons-round">print</span> Imprimir (Todos)';
        btnPrint.onclick = printLabels;

        document.getElementById('modal-labels').querySelector('.modal-content').appendChild(btnPrint);

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div style="text-align: center; color: var(--danger);">Error al cargar productos.</div>';
        showToast('Error cargando inventario', 'error');
    }
}

function updatePrintButton() {
    const container = document.getElementById('label-container');
    const selected = container.querySelectorAll('.qr-label.selected').length;
    const btn = document.getElementById('btn-print-labels');

    if (selected > 0) {
        btn.innerHTML = `<span class="material-icons-round">print</span> Imprimir Seleccionados (${selected})`;
    } else {
        btn.innerHTML = '<span class="material-icons-round">print</span> Imprimir (Todos)';
    }
}

function printLabels() {
    const container = document.getElementById('label-container');
    const selected = container.querySelectorAll('.qr-label.selected');

    if (selected.length > 0) {
        // Hide others
        container.querySelectorAll('.qr-label').forEach(el => el.style.display = 'none');
        selected.forEach(el => el.style.display = 'flex');

        window.print();

        // Restore
        container.querySelectorAll('.qr-label').forEach(el => el.style.display = 'flex');
    } else {
        window.print();
    }
}


/**
 * MISSING FUNCTIONS IMPLEMENTATION
 */

function closeModal() {
    document.querySelectorAll('.modal-backdrop').forEach(modal => {
        modal.classList.remove('active');
    });
    // Reset inputs
    document.getElementById('qty-input').value = 1;
    document.getElementById('new-id').value = '';
    document.getElementById('new-name').value = '';
    document.getElementById('new-stock').value = 0;
}

function openCreateModal() {
    document.getElementById('modal-create').classList.add('active');
    if (isAdmin) {
        document.getElementById('new-id').placeholder = "Vacío = Automático";
    }
}

async function manualInput() {
    const input = prompt("Ingresa el ID del producto manualmente:");
    if (input) {
        // Stop scanner if active to avoid conflicts
        if (isScanning) stopScanner();

        // Open product modal
        await openProductModal(input);
    }
}

function adjustQty(amount) {
    const input = document.getElementById('qty-input');
    let currentValue = parseInt(input.value) || 1;
    let newValue = currentValue + amount;

    // Minimo 1
    if (newValue < 1) newValue = 1;

    input.value = newValue;
}

async function openProductModal(idOrData) {
    // Determine if we have an ID string or object
    let product;

    // Check local lookup first
    if (typeof idOrData === 'string') {
        product = await fetchProduct(idOrData);
    } else {
        product = idOrData;
    }

    if (!product) {
        // Direct creation flow for new products
        document.getElementById('new-id').value = idOrData;
        openCreateModal();

        // Auto-focus name field for speed
        setTimeout(() => {
            const nameInput = document.getElementById('new-name');
            if (nameInput) nameInput.focus();
        }, 300);

        return;
    }

    // Set Global
    currentProduct = product;

    // UI
    document.getElementById('p-name').innerText = product.nombre;
    document.getElementById('p-id').innerText = product.id;
    document.getElementById('p-stock').innerText = product.stock;

    // Reset Qty
    document.getElementById('qty-input').value = 1;

    document.getElementById('modal-product').classList.add('active');
}
/**
 * ADMIN & SEARCH LOGIC
 */
function toggleAdmin() {
    document.getElementById('modal-login').classList.add('active');
    setTimeout(() => document.getElementById('admin-pass').focus(), 100);
}

function loginAdmin() {
    const pass = document.getElementById('admin-pass').value;
    if (pass === 'mantencioncermaq') {
        isAdmin = true;
        document.body.classList.add('admin-mode');
        closeModal();
        showToast('Modo Admin Activado', 'success');
        document.getElementById('admin-pass').value = '';

        if (deferredPrompt) document.getElementById('btn-install').style.display = 'flex';

        // Auto-ID visual feedback
        const newIdInput = document.getElementById('new-id');
        if (newIdInput) newIdInput.placeholder = "Vacío = Automático";
    } else {
        showToast('Contraseña incorrecta', 'error');
    }
}

function handleSearch() {
    const query = document.getElementById('search-input').value.toLowerCase();
    const container = document.getElementById('search-results');

    if (query.length < 2) {
        container.style.display = 'none';
        return;
    }

    if (!allProductsCache || allProductsCache.length === 0) {
        checkConnection();
    }

    const matches = allProductsCache.filter(p =>
        String(p.nombre).toLowerCase().includes(query) ||
        String(p.id).includes(query)
    ).slice(0, 5);

    if (matches.length > 0) {
        container.innerHTML = matches.map(p => `
            <div class="search-item" onclick="openProductModal('${p.id}')">
                <span>${p.nombre}</span>
                <span class="tag" style="background:var(--primary); color:white">${p.stock}</span>
            </div>
        `).join('');
        container.style.display = 'block';
    } else {
        container.style.display = 'none';
    }
}

// Install PWA
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

async function installPWA() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        document.getElementById('btn-install').style.display = 'none';
    }
}
