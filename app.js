/**
 * UFOX IOT DASHBOARD - CONTROLADOR PRINCIPAL
 * Este script maneja la autenticación y la carga de datos desde la API.
 */

// CONFIGURACIÓN
const API_URL = "https://dimoca-backend.onrender.com"; // URL del Backend (Docker)
const ENDPOINTS = {
    LOGIN: "/token",
    USER_INFO: "/users/me",
    MEDICIONES: "/mediciones" // Nuevo endpoint que agregamos en Python
};

// REFERENCIAS DOM
const UI = {
    screens: {
        login: document.getElementById("login-section"),
        dashboard: document.getElementById("dashboard-section"),
    },
    forms: {
        login: document.getElementById("login-form"),
    },
    displays: {
        temp: document.getElementById("last-temp"),
        hum: document.getElementById("last-hum"),
        bat: document.getElementById("last-bat"),
        tableBody: document.getElementById("tabla-datos"),
        errorMsg: document.getElementById("login-error"),
        loadingMsg: document.getElementById("loading-msg"),
    }
};

// VARIABLE PARA EL AUTO-REFRESH
let intervaloDeActualizacion = null;
let miGrafico = null;
let datosActuales = [];

// ==========================================
// 1. INICIALIZACIÓN
// ==========================================

// Verificar si hay sesión activa al cargar la página
document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("ufox_token");
    if (token) {
        validarSesion(token);
    }
});

// ==========================================
// 2. LÓGICA DE AUTENTICACIÓN
// ==========================================

UI.forms.login.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = document.getElementById("username").value;
    const pass = document.getElementById("password").value;

    // Limpiar errores previos
    UI.displays.errorMsg.innerText = "";

    try {
        // FastAPI OAuth2 espera x-www-form-urlencoded
        const formData = new URLSearchParams();
        formData.append("username", user);
        formData.append("password", pass);

        const response = await fetch(`${API_URL}${ENDPOINTS.LOGIN}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formData
        });

        if (!response.ok) throw new Error("Usuario o contraseña incorrectos");

        const data = await response.json();
        
        // Guardar Token y entrar
        localStorage.setItem("ufox_token", data.access_token);
        mostrarDashboard();

    } catch (error) {
        UI.displays.errorMsg.innerText = error.message;
    }
});

/**
 * Valida si el token guardado sigue siendo válido preguntando al backend
 */
async function validarSesion(token) {
    try {
        const response = await fetch(`${API_URL}${ENDPOINTS.USER_INFO}`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (response.ok) {
            mostrarDashboard();
        } else {
            logout(); // Token expirado o inválido
        }
    } catch (error) {
        console.error("Error de red al validar sesión:", error);
    }
}

function logout() {
    // --- NUEVO: DETENER AUTO-ACTUALIZACIÓN ---
    if (intervaloDeActualizacion) {
        clearInterval(intervaloDeActualizacion);
        intervaloDeActualizacion = null;
    }

    localStorage.removeItem("ufox_token");
    UI.screens.dashboard.classList.add("hidden");
    UI.screens.login.classList.remove("hidden");
    
    document.getElementById("username").value = "";
    document.getElementById("password").value = "";
}

function mostrarDashboard() {
    UI.screens.login.classList.add("hidden");
    UI.screens.dashboard.classList.remove("hidden");
    
    cargarDatosReales(); // Carga inmediata la primera vez

    // --- NUEVO: ACTIVAR AUTO-ACTUALIZACIÓN ---
    // Si ya había un reloj corriendo, lo limpiamos para no tener duplicados
    if (intervaloDeActualizacion) clearInterval(intervaloDeActualizacion);

    // Creamos un nuevo reloj que se ejecuta cada 5000 milisegundos (5 segundos)
    intervaloDeActualizacion = setInterval(() => {
        console.log("⏰ Auto-actualizando datos...");
        cargarDatosReales();
    }, 5000); 
}

// ==========================================
// 3. LÓGICA DE DATOS (IOT)
// ==========================================

async function cargarDatosReales() {
    const token = localStorage.getItem("ufox_token");
    if (!token) return logout();

    // 1. LEER VALORES
    const limite = document.getElementById('data-limit').value;
    const fechaInicio = document.getElementById('date-start').value;
    const fechaFin = document.getElementById('date-end').value;

    let urlFinal = `${API_URL}${ENDPOINTS.MEDICIONES}`;

    // 2. DECIDIR QUÉ FILTRO USAR
    if (fechaInicio && fechaFin) {
        // Si hay fechas, usamos el filtro de tiempo
        urlFinal += `?start_date=${fechaInicio}&end_date=${fechaFin}`;
    } else {
        // Si no, usamos el límite
        urlFinal += `?limit=${limite}`;
    }

    try {
        const response = await fetch(urlFinal, {
            method: "GET",
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (!response.ok) {
            if (response.status === 401) logout();
            throw new Error("Error al obtener datos");
        }

        const mediciones = await response.json();

        datosActuales = mediciones;
        
        if (mediciones.length === 0) {
            // Manejo de vacío
            // Sugerencia: Limpiar gráfico si no hay datos
            if(miGrafico) {
                miGrafico.data.labels = [];
                miGrafico.data.datasets.forEach((dataset) => { dataset.data = []; });
                miGrafico.update();
            }
            UI.displays.tableBody.innerHTML = `<tr><td colspan="5" class="text-center">No hay datos en este rango.</td></tr>`;
            return;
        }

        // 1. Renderizar Tabla (Igual que antes)
        renderizarTabla(mediciones);
        
        // 2. Actualizar KPIs (Igual que antes)
        actualizarTarjetas(mediciones[0]);

        // 3. ACTUALIZAR GRÁFICO (NUEVO)
        actualizarGrafico(mediciones);

        // 4. VERIFICAR ALERTAS (NUEVO)
        // Usamos mediciones[0] porque es el dato más reciente
        verificarUmbrales(mediciones[0]);

    } catch (error) {
        console.error(error);
    } finally {
        UI.displays.loadingMsg.classList.add("hidden");
    }
}

// --- FUNCIÓN PARA PINTAR EL GRÁFICO ---
function actualizarGrafico(datos) {
    const ctx = document.getElementById('myChart');
    const chartBody = document.getElementById('chart-body');

    if (!ctx) return;

    const datosCronologicos = [...datos].reverse();

    // 1. AJUSTE DE ANCHO (SCROLL)
    if (datosCronologicos.length > 30) {
        const nuevoAncho = datosCronologicos.length * 30; 
        chartBody.style.width = `${nuevoAncho}px`; 
    } else {
        chartBody.style.width = '100%';
    }
    
    // 2. PREPARAR DATOS
    const etiquetas = datosCronologicos.map(d => new Date(d.fecha + "Z").toLocaleTimeString());
    const temperaturas = datosCronologicos.map(d => d.temperatura);
    const humedades = datosCronologicos.map(d => d.humedad);

    // 3. ACTUALIZAR O CREAR
    if (miGrafico) {
        // Actualizamos datos
        miGrafico.data.labels = etiquetas;
        miGrafico.data.datasets[0].data = temperaturas;
        miGrafico.data.datasets[1].data = humedades;
        
        // Importante: Avisar que el tamaño del div pudo haber cambiado
        miGrafico.resize(); 
        miGrafico.update();
        return;
    }

    // CREACIÓN INICIAL
    miGrafico = new Chart(ctx, {
        type: 'line',
        data: {
            labels: etiquetas,
            datasets: [
                {
                    label: 'Temperatura (°C)',
                    data: temperaturas,
                    borderColor: '#ef4444', 
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    tension: 0.4,
                    fill: true
                },
                {
                    label: 'Humedad (%)',
                    data: humedades,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false, // ESTO ES OBLIGATORIO PARA EL SCROLL
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function renderizarTabla(listaDatos) {
    // Generamos el HTML de cada fila
    const filasHTML = listaDatos.map(dato => {
        // Formatear fecha bonita (ej: 10/12/2025, 14:30:00)
        const fecha = new Date(dato.fecha + "Z").toLocaleString();
        
        return `
            <tr>
                <td>${fecha}</td>
                <td><strong>${dato.device_id}</strong></td>
                <td>${dato.temperatura} °C</td>
                <td>${dato.humedad} %</td>
                <td>
                    <span style="color: ${dato.bateria < 20 ? 'red' : 'green'}">
                        ${dato.bateria} %
                    </span>
                </td>
            </tr>
        `;
    }).join("");

    UI.displays.tableBody.innerHTML = filasHTML;
}

function actualizarTarjetas(ultimoDato) {
    if (!ultimoDato) {
        UI.displays.temp.innerText = "-- °C";
        UI.displays.hum.innerText = "-- %";
        UI.displays.bat.innerText = "-- %";
        return;
    }
    UI.displays.temp.innerText = `${ultimoDato.temperatura} °C`;
    UI.displays.hum.innerText = `${ultimoDato.humedad} %`;
    UI.displays.bat.innerText = `${ultimoDato.bateria} %`;
}

// ==========================================
// 4. LÓGICA DE NAVEGACIÓN (TABS)
// ==========================================

function cambiarPestana(pestana) {
    // 1. Quitar clase 'active' a todos los botones
    document.getElementById('tab-home').classList.remove('active');
    document.getElementById('tab-charts').classList.remove('active');

    // 2. Ocultar todas las vistas
    document.getElementById('view-home').classList.add('hidden');
    document.getElementById('view-charts').classList.add('hidden');

    // 3. Activar la seleccionada
    if (pestana === 'home') {
        document.getElementById('tab-home').classList.add('active');
        document.getElementById('view-home').classList.remove('hidden');
    } else {
        document.getElementById('tab-charts').classList.add('active');
        document.getElementById('view-charts').classList.remove('hidden');
        
        // --- SOLUCIÓN DEL ERROR ---
        // Si el gráfico existe, obligamos a Chart.js a recalcular el tamaño
        // porque ahora el div ya no está oculto (display: none).
        if (miGrafico) {
            miGrafico.resize(); // <--- ESTA LÍNEA ES LA CLAVE
            miGrafico.update();
        }
    }
}

// Necesitamos hacer esta función global para que el HTML la encuentre
window.cambiarPestana = cambiarPestana;

// ==========================================
// 5. FUNCIONES DE GRÁFICOS Y CONTROLES
// ==========================================

function toggleDataset(index) {
    if (!miGrafico) return;
    
    // Obtenemos si el checkbox está marcado o no
    const isVisible = miGrafico.isDatasetVisible(index);
    
    if (isVisible) {
        miGrafico.hide(index); // Ocultar
    } else {
        miGrafico.show(index); // Mostrar
    }
}
// Hacerla global para el HTML
window.toggleDataset = toggleDataset;

function verificarUmbrales(ultimoDato) {
    if (!ultimoDato) return;

    const divAlertas = document.getElementById('chart-alerts');
    const limiteTemp = parseFloat(document.getElementById('limit-temp').value) || 1000;
    const limiteHum = parseFloat(document.getElementById('limit-hum').value) || 1000;

    let mensajes = [];

    // Verificamos Temperatura
    if (ultimoDato.temperatura > limiteTemp) {
        mensajes.push(`⚠️ ALERTA: La Temperatura actual (${ultimoDato.temperatura}°C) supera el límite de ${limiteTemp}°C.`);
    }

    // Verificamos Humedad
    if (ultimoDato.humedad > limiteHum) {
        mensajes.push(`⚠️ ALERTA: La Humedad actual (${ultimoDato.humedad}%) supera el límite de ${limiteHum}%.`);
    }

    // Mostrar u Ocultar la caja de alertas
    if (mensajes.length > 0) {
        divAlertas.innerHTML = mensajes.join('<br>'); // Unir mensajes con salto de línea
        divAlertas.classList.remove('hidden');
    } else {
        divAlertas.classList.add('hidden');
        divAlertas.innerHTML = '';
    }
}

// Función para limpiar fechas si el usuario elige "Últimos X"
function limpiarFechas() {
    document.getElementById('date-start').value = '';
    document.getElementById('date-end').value = '';
}

// (Opcional) Puedes agregar lógica visual aquí si quieres
function activarModoFecha() {
    // Solo para indicar que estamos editando fechas
    console.log("Modo fecha activado");
}

// ==========================================
// 6. EXPORTACIÓN A EXCEL (CSV)
// ==========================================

function descargarCSV() {
    if (!datosActuales || datosActuales.length === 0) {
        alert("No hay datos para descargar.");
        return;
    }

    // 1. Crear encabezados del CSV
    let csvContent = "Fecha,Hora,Dispositivo,Temperatura,Humedad,Bateria\n";

    // 2. Recorrer los datos y convertirlos a texto
    datosActuales.forEach(fila => {
        // Convertir fecha UTC a Local para el Excel
        const fechaObj = new Date(fila.fecha + "Z"); 
        const fecha = fechaObj.toLocaleDateString();
        const hora = fechaObj.toLocaleTimeString();

        // Armar la línea: fecha,hora,id,temp,hum,bat
        // Usamos template string y salto de línea \n
        let row = `${fecha},${hora},${fila.device_id},${fila.temperatura},${fila.humedad},${fila.bateria}`;
        csvContent += row + "\n";
    });

    // 3. Crear un "Blob" (Archivo virtual)
    // El BOM (\uFEFF) es un truco para que Excel reconozca tildes y caracteres especiales
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    
    // 4. Crear enlace invisible de descarga
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    
    // Nombre del archivo con fecha actual (ej: reporte_2025-12-11.csv)
    const hoy = new Date().toISOString().slice(0,10);
    link.setAttribute("download", `reporte_ufox_${hoy}.csv`);
    
    // 5. Simular clic y limpiar
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}