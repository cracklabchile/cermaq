
// CONFIGURACIÓN DE COLUMNAS (Basado en tu archivo)
const KOL = {
  ID: 0,          // Columna A: Nº ARTICULO
  NOMBRE: 1,      // Columna B: DESCRIPCION
  STOCK: 3        // Columna D: STOCK
};

const HOJA_INVENTARIO = "2026"; // Asegúrate que tu hoja se llame así o cambia este nombre
const HOJA_LOGS = "MOVIMIENTOS";

// ==========================================
// API DEL SISTEMA (No tocar)
// ==========================================

function doGet(e) {
  // Esta función entrega la lista de productos al Escáner
  const data = obtenerInventario();
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  // Esta función recibe las órdenes de INGRESO/SALIDA desde el Escáner
  try {
    const params = JSON.parse(e.postData.contents);
    const accion = params.action; // "IN", "OUT", "ADD"
    
    if (accion === "IN" || accion === "OUT") {
      return procesarMovimiento(params);
    } else if (accion === "ADD") {
      return agregarProducto(params);
    } else {
      return respuestaJSON({ error: "Acción no válida" });
    }
  } catch (error) {
    return respuestaJSON({ error: error.toString() });
  }
}

// ==========================================
// LÓGICA DE NEGOCIO
// ==========================================

function obtenerInventario() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_INVENTARIO);
  if (!sheet) return [];

  // Leemos toda la tabla
  const data = sheet.getDataRange().getValues();
  // Saltamos la fila 1 (encabezados)
  const rows = data.slice(1);

  // Mapeamos a un formato limpio para la App
  return rows.map(r => ({
    id: r[KOL.ID],
    nombre: r[KOL.NOMBRE],
    stock: r[KOL.STOCK]
  })).filter(item => item.id != ""); // Filtramos filas vacías
}

function procesarMovimiento(datos) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(HOJA_INVENTARIO);
  const logSheet = ss.getSheetByName(HOJA_LOGS);
  
  const idBusqueda = String(datos.id);
  const cantidad = parseInt(datos.quantity);
  const usuario = datos.user || "App";
  
  const data = sheet.getDataRange().getValues();
  let filaEncontrada = -1;
  
  // Buscamos el producto por su ID (Columna A)
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][KOL.ID]) === idBusqueda) {
      filaEncontrada = i + 1; // +1 porque array es base 0, sheet es base 1
      break;
    }
  }

  if (filaEncontrada === -1) {
    return respuestaJSON({ status: "error", message: "Producto no encontrado. ID: " + idBusqueda });
  }

  // Obtenemos celda de stock actual
  // getRange(fila, columna) -> La columna es índice + 1
  const celdaStock = sheet.getRange(filaEncontrada, KOL.STOCK + 1);
  const stockActual = parseInt(celdaStock.getValue()) || 0;
  
  let nuevoStock = stockActual;
  
  if (datos.action === "IN") {
    nuevoStock += cantidad;
  } else {
    // Validación de stock negativo
    if (stockActual < cantidad) {
      return respuestaJSON({ status: "error", message: "Stock insuficiente. Tienes: " + stockActual });
    }
    nuevoStock -= cantidad;
  }
  
  // Guardamos el nuevo stock
  celdaStock.setValue(nuevoStock);

  // ACTUALIZAR NOMBRE SI SE PROPORCIONA (Requisito User: "poder editar el nombre")
  if (datos.nombre && datos.nombre !== data[filaEncontrada-1][KOL.NOMBRE]) {
    sheet.getRange(filaEncontrada, KOL.NOMBRE + 1).setValue(datos.nombre);
  }
  
  // Registramos en el Historial
  if (logSheet) {
    logSheet.appendRow([
      new Date(),           // Fecha
      datos.action,         // Acción (IN/OUT)
      idBusqueda,           // ID Producto
      data[filaEncontrada-1][KOL.NOMBRE], // Nombre Producto
      cantidad,             // Cantidad
      nuevoStock,           // Stock Resultante
      usuario,              // Quién lo hizo
      datos.comment || "",  // COMENTARIO (Nuevo)
      datos.price || ""     // PRECIO (Nuevo)
    ]);
  }
  
  return respuestaJSON({ 
    status: "success", 
    message: "Actualizado correctamente", 
    productName: data[filaEncontrada-1][KOL.NOMBRE],
    newStock: nuevoStock
  });
}

function agregarProducto(datos) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_INVENTARIO);
  
  if (!sheet) return respuestaJSON({ status: "error", message: "No se encontró la hoja " + HOJA_INVENTARIO });

  const data = sheet.getDataRange().getValues();
  let idNuevo = String(datos.id);
  
  // LÓGICA AUTO-ID
  if (idNuevo === "AUTO" || idNuevo === "") {
     let maxId = 0;
     // Buscamos el ID más alto numérico
     for (let i = 1; i < data.length; i++) {
       let val = parseInt(data[i][KOL.ID]);
       if (!isNaN(val) && val > maxId) {
         maxId = val;
       }
     }
     idNuevo = String(maxId + 1);
  }
  
  // Validar duplicados (solo si no fue generado automáticamente, aunque igual sirve)
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][KOL.ID]) === idNuevo) {
      return respuestaJSON({ status: "error", message: "El ID ya existe: " + idNuevo });
    }
  }
  
  // Agregar fila nueva
  // Estructura: [ID, NOMBRE, UNIDAD, STOCK, CATEGORIA, PRECIO, VALORIZADO]
  sheet.appendRow([
    idNuevo,            // A (Usamos el ID calculado o asignado)
    datos.nombre,       // B
    "UNIDAD",           // C (Default)
    datos.stock || 0,   // D
    "GENERAL",          // E (Categoría default)
    datos.precio || 0,  // F
    ""                  // G
  ]);
  
  return respuestaJSON({ 
    status: "success", 
    message: "Producto creado correctamente. ID: " + idNuevo,
    newId: idNuevo 
  });
}


function guardarFotoDiaria() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetInv = ss.getSheetByName(HOJA_INVENTARIO);
  let sheetHist = ss.getSheetByName("HISTORIAL_STOCK");
  
  if (!sheetHist) {
    sheetHist = ss.insertSheet("HISTORIAL_STOCK");
    sheetHist.appendRow(["FECHA_FOTO", "ID", "NOMBRE", "STOCK"]);
    sheetHist.setTabColor("purple");
  }
  
  const data = sheetInv.getDataRange().getValues();
  // Asumimos fila 1 headers
  const timestamp = new Date();
  
  const filasNuevas = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    // Solo guardar si tiene ID válido
    if (row[KOL.ID]) {
      filasNuevas.push([
        timestamp,
        row[KOL.ID],
        row[KOL.NOMBRE],
        row[KOL.STOCK]
      ]);
    }
  }
  
  if (filasNuevas.length > 0) {
    // Escritura en lote para eficiencia
    sheetHist.getRange(sheetHist.getLastRow() + 1, 1, filasNuevas.length, 4).setValues(filasNuevas);
  }
}

// ==========================================
// UTILIDADES
// ==========================================

function respuestaJSON(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function CONFIGURAR_SISTEMA() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Verificar si existe hoja MOVIEMIENTOS, si no, crearla
  // 1. Verificar si existe hoja MOVIEMIENTOS, si no, crearla
  let sheetLogs = ss.getSheetByName(HOJA_LOGS);
  if (!sheetLogs) {
    sheetLogs = ss.insertSheet(HOJA_LOGS);
    sheetLogs.appendRow(["FECHA", "ACCION", "ID_ARTICULO", "NOMBRE", "CANTIDAD", "SALDO_STOCK", "USUARIO", "COMENTARIO", "PRECIO_UNITARIO"]);
    sheetLogs.setTabColor("orange");
  } else {
    // Si ya existe, verificar si tiene las nuevas columnas
    const headers = sheetLogs.getRange(1, 1, 1, sheetLogs.getLastColumn()).getValues()[0];
    if (headers.indexOf("COMENTARIO") === -1) {
       sheetLogs.getRange(1, headers.length + 1).setValue("COMENTARIO");
       sheetLogs.getRange(1, headers.length + 2).setValue("PRECIO_UNITARIO");
    }
  }

  // 3. Crear Trigger Diario para Snapshot
  const triggers = ScriptApp.getProjectTriggers();
  let triggerExiste = false;
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "guardarFotoDiaria") triggerExiste = true;
  });
  
  if (!triggerExiste) {
    ScriptApp.newTrigger("guardarFotoDiaria")
      .timeBased()
      .atHour(1) // 1:00 AM
      .everyDays(1)
      .create();
  }
  
  // 2. Verificar nombre hoja inventario
  const sheetInv = ss.getSheets()[0]; // Asumimos que la primera es el inventario
  if (sheetInv.getName() !== HOJA_INVENTARIO) {
    const ui = SpreadsheetApp.getUi();
    const response = ui.alert('Configuración', '¿Podemos renombrar la hoja "' + sheetInv.getName() + '" a "' + HOJA_INVENTARIO + '" para que funcione el sistema?', ui.ButtonSet.YES_NO);
    if (response == ui.Button.YES) {
      sheetInv.setName(HOJA_INVENTARIO);
    } else {
      ui.alert('Importante: Asegúrate de cambiar manualmente el nombre de la hoja principal a "' + HOJA_INVENTARIO + '" o editar el código.');
    }
  }
  
  SpreadsheetApp.getUi().alert("¡Sistema Configurado! Ahora realiza la Implantación como Aplicación Web.");
}
