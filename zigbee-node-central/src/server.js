var SerialPort = require('serialport');
var xbee_api = require('xbee-api');
var C = xbee_api.constants;
require('dotenv').config()
const fs = require('fs');
const path = require('path');

// Définition des constantes LED pour le scope global
const LED_D1 = "D1";
const LED_D2 = "D2";
const LED_ON = 4;  // 4 = Digital High (0x04 en hex)
const LED_OFF = 0; // 0 = Digital Low (0x00 en hex)

const handleBac = require('./utils/chrono');
const mqtt = require('mqtt');
const mqttClient = mqtt.connect('mqtt://test.mosquitto.org');
const ButtonHandler = require('./utils/ButtonHandler');
const handleSeat = require('./utils/handleSeatSensor');
const config = require('./config');

const BROADCAST_ADDRESS = "FFFFFFFFFFFFFFFF";

// Tableau pour stocker l'association entre les XBee découverts et les tables
let tableAssociations = {};

// Variables pour suivre le prochain ID de table disponible
let nextTableId = 1;

// Chemin du fichier d'associations des tables
const TABLE_ASSOC_FILE = path.join(__dirname, '../config/table-associations.json');

// Fonction pour charger les associations de tables depuis un fichier
function loadTableAssociations() {
  try {
    // Vérifier si le répertoire existe, sinon le créer
    const configDir = path.dirname(TABLE_ASSOC_FILE);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    // Vérifier si le fichier existe
    if (fs.existsSync(TABLE_ASSOC_FILE)) {
      const data = fs.readFileSync(TABLE_ASSOC_FILE, 'utf8');
      const parsed = JSON.parse(data);
      
      if (parsed.tableAssociations && typeof parsed.tableAssociations === 'object') {
        tableAssociations = parsed.tableAssociations;
        nextTableId = parsed.nextTableId || 1;
        
        console.log(`✅ Associations de tables chargées: ${Object.keys(tableAssociations).length} XBee(s) associé(s)`);
        Object.entries(tableAssociations).forEach(([xbeeId, info]) => {
          console.log(`  - XBee ${xbeeId} associé à la Table ${info.tableId}`);
        });
        
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error("Erreur lors du chargement des associations de tables:", error.message);
    return false;
  }
}

// Fonction pour sauvegarder les associations de tables dans un fichier
function saveTableAssociations() {
  try {
    // Vérifier si le répertoire existe, sinon le créer
    const configDir = path.dirname(TABLE_ASSOC_FILE);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    const data = JSON.stringify({
      tableAssociations: tableAssociations,
      nextTableId: nextTableId
    }, null, 2);
    
    fs.writeFileSync(TABLE_ASSOC_FILE, data, 'utf8');
    console.log(`✅ Associations de tables sauvegardées: ${Object.keys(tableAssociations).length} association(s)`);
    return true;
  } catch (error) {
    console.error("Erreur lors de la sauvegarde des associations de tables:", error.message);
    return false;
  }
}

// Charger les associations au démarrage
loadTableAssociations();

// Fonction pour obtenir l'ID de table à partir de l'adresse MAC XBee
function getTableIdFromXbeeId(xbeeId) {
  if (!xbeeId) return null;
  
  // Normaliser l'ID en minuscules pour la comparaison
  const normalizedId = xbeeId.toLowerCase();
  
  // Chercher si on a une association pour ce XBee
  return tableAssociations[normalizedId]?.tableId || null;
}

// Fonction pour ajouter ou mettre à jour un XBee dans les associations
function addOrUpdateXbeeAssociation(xbeeId, nodeIdentifier = null) {
  if (!xbeeId) return null;
  
  // Normaliser l'ID en minuscules pour la comparaison
  const normalizedId = xbeeId.toLowerCase();
  
  // Vérifier si ce XBee est déjà associé à une table
  if (tableAssociations[normalizedId]) {
    // Mise à jour si on a un nouvel identifiant de nœud
    if (nodeIdentifier && nodeIdentifier.trim() !== '') {
      tableAssociations[normalizedId].nodeIdentifier = nodeIdentifier;
      tableAssociations[normalizedId].description = `Table ${tableAssociations[normalizedId].tableId} (${nodeIdentifier})`;
    }
    console.log(`XBee ${xbeeId} déjà associé à la Table ${tableAssociations[normalizedId].tableId}`);
    return tableAssociations[normalizedId];
  } else {
    // Créer une nouvelle association
    const tableId = nextTableId++;
    const description = nodeIdentifier && nodeIdentifier.trim() !== '' 
      ? `Table ${tableId} (${nodeIdentifier})` 
      : `Table ${tableId}`;
    
    const newAssociation = {
      tableId: tableId,
      nodeIdentifier: nodeIdentifier || "",
      description: description,
      lastSeen: new Date().toISOString()
    };
    
    tableAssociations[normalizedId] = newAssociation;
    console.log(`✅ Nouveau XBee détecté: ${xbeeId} - Associé à la Table ${tableId}`);
    
    // Configurer ce nouveau XBee
    configureXbee(xbeeId, newAssociation);
    
    // Sauvegarder les associations après un ajout
    setTimeout(saveTableAssociations, 500);
    
    return newAssociation;
  }
}

// Fonction pour obtenir toutes les adresses MAC des XBee configurés
function getAllXbeeIds() {
  return Object.keys(tableAssociations);
}

// Fonction pour envoyer des commandes AT avec un délai entre elles
function sendATCommandWithDelay(commands, index = 0) {
  if (index >= commands.length) {
    return;
  }
  
  const command = commands[index];
  xbeeAPI.builder.write(command);
  
  // Attendre 300ms avant d'envoyer la commande suivante
  setTimeout(() => {
    sendATCommandWithDelay(commands, index + 1);
  }, 300);
}

// Fonction pour configurer un XBee spécifique
function configureXbee(xbeeId, association) {
  console.log(`Configuration du XBee ${xbeeId} pour la Table ${association.tableId}`);
  
  const commands = [];
  
  // Configurer D0 comme entrée numérique avec pull-up (mode 3)
  commands.push({
    type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
    destination64: xbeeId,
    command: "D0",
    commandParameter: [3], // 3 = Digital Input avec pull-up
  });
  
  // Configurer la détection de changement (IC)
  commands.push({
    type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
    destination64: xbeeId,
    command: "IC",
    commandParameter: [1], // Activer la détection de changement sur D0
  });
  
  // Désactiver l'échantillonnage périodique
  commands.push({
    type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
    destination64: xbeeId,
    command: "IR", 
    commandParameter: [0, 0], // Désactiver l'échantillonnage périodique
  });
  
  // Configurer D1 et D2 comme sorties numériques
  commands.push({
    type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
    destination64: xbeeId,
    command: "D1",
    commandParameter: [4], // 4 = Digital Out, Low
  });
  
  commands.push({
    type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
    destination64: xbeeId,
    command: "D2",
    commandParameter: [4], // 4 = Digital Out, Low
  });
  
  // Sauvegarder et appliquer les paramètres
  commands.push({
    type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
    destination64: xbeeId,
    command: "AC", // Apply Changes
    commandParameter: [],
  });
  
  // Envoyer les commandes avec un délai entre elles
  sendATCommandWithDelay(commands);
  
  // Initialiser un ButtonHandler pour cette table si nécessaire
  if (!global.buttonHandlers) {
    global.buttonHandlers = {};
  }
  
  if (!global.buttonHandlers[association.tableId]) {
    console.log(`Initialisation du ButtonHandler pour la Table ${association.tableId}`);
    global.buttonHandlers[association.tableId] = new ButtonHandler(xbeeAPI, mqttClient);
    global.buttonHandlers[association.tableId].tableId = association.tableId;
    global.buttonHandlers[association.tableId].xbeeId = xbeeId;
  }
}

mqttClient.on('connect', () => {
  console.log('✅ Connecté au broker MQTT');

  // S'abonner aux topics de commande pour toutes les tables
  mqttClient.subscribe('restaurant/tables/+/order_ready', (err) => {
    if (err) console.error('Erreur de souscription à order_ready:', err);
    else console.log('Abonné à restaurant/tables/+/order_ready');
  });
  
  mqttClient.subscribe('restaurant/tables/+/ready_to_order', (err) => {
    if (err) console.error('Erreur de souscription à ready_to_order:', err);
    else console.log('Abonné à restaurant/tables/+/ready_to_order');
  });

  // S'abonner aux autres topics nécessaires
  mqttClient.subscribe(config.mqtt.topics.sensorCommand, (err) => {
    if (err) console.error('Erreur de souscription:', err);
  });

  mqttClient.subscribe(config.mqtt.topics.moduleControl, (err) => {
    if (err) console.error('Erreur de souscription:', err);
  });
  
  // Gestionnaire global des messages MQTT
  mqttClient.on('message', (topic, message) => {
    try {
      // Extraire l'ID de table du topic
      let tableId = null;
      
      if (topic.startsWith('restaurant/tables/')) {
        const parts = topic.split('/');
        if (parts.length >= 3) {
          tableId = parseInt(parts[2], 10);
        }
      }
      
      // Si on a un ID de table valide
      if (tableId) {
        try {
          const data = JSON.parse(message.toString());
          
          // Vérifier si le message contient explicitement un ID de table différent
          const messageTableId = data.table || tableId;
          
          // Si le messageTableId est différent de tableId, utiliser celui du message
          if (messageTableId !== tableId) {
            tableId = messageTableId;
          }
          
          // Récupérer l'ID XBee correspondant à cette table
          let xbeeId = null;
          
          // Chercher l'association table -> XBee
          for (const [id, assoc] of Object.entries(tableAssociations)) {
            if (assoc.tableId === tableId) {
              xbeeId = id;
              break;
            }
          }
          
          if (!xbeeId) {
            console.log(`Aucun XBee associé à la Table ${tableId}`);
            return;
          }
          
          // Vérifier si on a déjà un gestionnaire pour cette table
          if (!global.buttonHandlers || !global.buttonHandlers[tableId]) {
            // Initialiser le handler
            if (!global.buttonHandlers) {
              global.buttonHandlers = {};
            }
            
            global.buttonHandlers[tableId] = new ButtonHandler(xbeeAPI, mqttClient);
            global.buttonHandlers[tableId].tableId = tableId;
            global.buttonHandlers[tableId].xbeeId = xbeeId;
          } else {
            // S'assurer que le handler existant utilise le bon XBee ID
            global.buttonHandlers[tableId].xbeeId = xbeeId;
          }
          
          // Traiter le message selon le type
          if (topic.endsWith('order_ready')) {
            console.log(`Ordre prêt reçu - Table ${tableId} - État: ${data.state}`);
            
            // Contrôle de la LED D2 (et réinitialisation de D1) pour order_ready
            if (data.state === 'on') {
              // Éteindre D1 d'abord (reset)
              global.buttonHandlers[tableId].directControlLED(LED_OFF, LED_D1);
              // Allumer D2
              global.buttonHandlers[tableId].directControlLED(LED_ON, LED_D2);
            } else {
              // Éteindre D1 d'abord (reset)
              global.buttonHandlers[tableId].directControlLED(LED_OFF, LED_D1);
              // Éteindre D2
              global.buttonHandlers[tableId].directControlLED(LED_OFF, LED_D2);
            }
            
            // Reset de l'état du bouton pour le prochain appui
            global.buttonHandlers[tableId].isLedOn = false;
            global.buttonHandlers[tableId].lastButtonState = 1;
          }
          else if (topic.endsWith('ready_to_order')) {
            console.log(`Prêt à commander reçu - Table ${tableId} - État: ${data.state}`);
            
            // Contrôle de la LED D1 pour ready_to_order
            if (data.state === 'on') {
              global.buttonHandlers[tableId].directControlLED(LED_ON, LED_D1);
            } else {
              global.buttonHandlers[tableId].directControlLED(LED_OFF, LED_D1);
            }
          }
        } catch (error) {
          console.error(`Erreur de traitement du message pour Table ${tableId}:`, error.message);
        }
      }
      // Autres types de messages MQTT
      else if (topic === config.mqtt.topics.moduleControl) {
        console.log("Message de contrôle de module reçu");
        // Traitement des messages de contrôle de module
      }
    } catch (error) {
      console.error('Erreur de traitement du message MQTT:', error.message);
    }
  });
});

if (!process.env.SERIAL_PORT)
  throw new Error('Missing SERIAL_PORT environment variable');

if (!process.env.SERIAL_BAUDRATE)
  throw new Error('Missing SERIAL_BAUDRATE environment variable');

// Replace with your serial port and baud rate (9600 by default)
const SERIAL_PORT = process.env.SERIAL_PORT;

// Ensure to configure your XBEE Module in API MODE 2 (comme indiqué dans le commentaire original)
var xbeeAPI = new xbee_api.XBeeAPI({
  api_mode: 2  // Changer de 1 à 2 pour correspondre au mode API des XBee
});

let serialport = new SerialPort(SERIAL_PORT, {
  baudRate: parseInt(process.env.SERIAL_BAUDRATE) || 9600,
}, function (err) {
  if (err) {
    return console.log('Creating SerialPort', err.message)
  }
});

serialport.pipe(xbeeAPI.parser);
xbeeAPI.builder.pipe(serialport);

// Fonction pour gérer l'état du bouton en fonction de la table
function handleButtonForTable(buttonState, tableId, xbeeId) {
  // Si on n'a pas d'ID XBee, on ne peut rien faire
  if (!xbeeId) return;
  
  // Normaliser l'ID XBee
  const normalizedXbeeId = xbeeId.toLowerCase();
  
  // Si on n'a pas d'ID de table mais qu'on a un XBee ID, chercher ou créer une association
  if (!tableId) {
    // Vérifier si ce XBee est déjà associé à une table
    if (tableAssociations[normalizedXbeeId]) {
      tableId = tableAssociations[normalizedXbeeId].tableId;
    } else {
      // Créer une nouvelle association
      const association = addOrUpdateXbeeAssociation(xbeeId);
      if (association) {
        tableId = association.tableId;
      } else {
        console.error(`Impossible de créer une association pour le XBee ${xbeeId}`);
        return;
      }
    }
  }
  
  // Créer un buttonHandler spécifique à la table si nécessaire
  if (!global.buttonHandlers) {
    global.buttonHandlers = {};
  }
  
  if (!global.buttonHandlers[tableId]) {
    console.log(`Initialisation du ButtonHandler pour la Table ${tableId}`);
    global.buttonHandlers[tableId] = new ButtonHandler(xbeeAPI, mqttClient);
    
    // Stocker l'ID de table pour les publications MQTT
    global.buttonHandlers[tableId].tableId = tableId;
    
    // Utiliser l'ID XBee
    global.buttonHandlers[tableId].xbeeId = xbeeId;
    
    console.log(`Table ${tableId} associée au XBee: ${xbeeId}`);
  }
  
  // Utiliser le ButtonHandler spécifique à cette table
  global.buttonHandlers[tableId].handleButtonState(buttonState, xbeeId);
}

serialport.on("open", function () {
  console.log("Serial port opened successfully");
  
  // Identifier tous les modules XBee immédiatement
  console.log("Recherche des XBee sur le réseau...");
  
  var localNI = {
    type: C.FRAME_TYPE.AT_COMMAND,
    command: "NI",
    commandParameter: [],
  };
  xbeeAPI.builder.write(localNI);
  
  var remoteNI = {
    type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
    destination64: BROADCAST_ADDRESS,
    command: "NI",
    commandParameter: [],
  };
  xbeeAPI.builder.write(remoteNI);
  
  // Activer les notifications de jointure sur le coordinateur
  var joinNotif = {
    type: C.FRAME_TYPE.AT_COMMAND,
    command: "JN",
    commandParameter: [1], // 1 = Enable Join Notification
  };
  xbeeAPI.builder.write(joinNotif);
});

// All frames parsed by the XBee will be emitted here
xbeeAPI.parser.on("data", function (frame) {
  // Traiter différents types de trames
  
  // 1. Détecter les notification de jointure (JoinNotification)
  if (frame.type === C.FRAME_TYPE.ZIGBEE_TRANSMIT_STATUS) {
    if (frame.deliveryStatus === 0) {
      console.log("Transmission réussie");
    }
    return;
  }
  
  // 2. Traiter les réponses aux commandes AT - pour les identifiants des nœuds (NI)
  if (frame.type === C.FRAME_TYPE.AT_COMMAND_RESPONSE || frame.type === C.FRAME_TYPE.REMOTE_COMMAND_RESPONSE) {
    if (frame.command === "NI" && frame.commandStatus === 0) {
      const nodeId = frame.commandData ? frame.commandData.toString() : "";
      
      if (frame.remote64) {
        console.log(`Réponse NI du module XBee ${frame.remote64}: "${nodeId}"`);
        // Ajouter ou mettre à jour la configuration avec l'ID du nœud
        addOrUpdateXbeeAssociation(frame.remote64, nodeId);
      } else {
        console.log(`Réponse NI du coordinateur: "${nodeId}"`);
      }
    } else if (frame.commandStatus !== 0) {
      console.log(`Erreur commande ${frame.command}: status ${frame.commandStatus}`);
    }
    return;
  }
  
  // 3. Traiter les nouvelles connexions au réseau (Join Notifications)
  if (frame.type === C.FRAME_TYPE.ZIGBEE_JOIN_NOTIFICATION) {
    console.log(`🔌 Nouveau XBee détecté! Adresse MAC: ${frame.remote64}`);
    
    // Ajouter à la configuration
    const newAssociation = addOrUpdateXbeeAssociation(frame.remote64);
    
    // Demander son identifiant après l'avoir ajouté
    if (newAssociation) {
      setTimeout(() => {
        const niCommand = {
          type: C.FRAME_TYPE.REMOTE_AT_COMMAND_REQUEST,
          destination64: frame.remote64,
          command: "NI",
          commandParameter: [],
        };
        xbeeAPI.builder.write(niCommand);
      }, 1000); // Attendre 1s pour s'assurer que le XBee est bien connecté
    }
    
    return;
  }
  
  // Obtenir l'ID de table à partir de l'adresse XBee (si disponible)
  let tableId = null;
  if (frame.remote64) {
    tableId = getTableIdFromXbeeId(frame.remote64);
    
    // Si on ne connaît pas encore ce XBee, l'ajouter à la configuration
    if (!tableId && frame.remote64 !== BROADCAST_ADDRESS) {
      console.log(`XBee inconnu détecté: ${frame.remote64}. Ajout à la configuration...`);
      const newAssociation = addOrUpdateXbeeAssociation(frame.remote64);
      if (newAssociation) {
        tableId = newAssociation.tableId;
      }
    }
  }

  // Récupérer la valeur des entrées analogiques
  const analogValueAD0 = frame.analogSamples?.AD0;
  const analogValueAD1 = frame.analogSamples?.AD1;
  const analogValueAD2 = frame.analogSamples?.AD2;

  // Handle button state changes if frame is from a recognized XBee
  if (frame.type === xbee_api.constants.FRAME_TYPE.ZIGBEE_IO_DATA_SAMPLE_RX) {
    // Si on a un XBee mais que l'ID XBee n'est pas encore dans les associations
    if (frame.remote64 && !tableId && frame.remote64 !== BROADCAST_ADDRESS) {
      const newAssociation = addOrUpdateXbeeAssociation(frame.remote64);
      if (newAssociation) {
        tableId = newAssociation.tableId;
      }
    }
    
    // Si on a un ID de table valide
    if (frame.remote64 && tableId) {      
      // Handle button state depending on whether we're looking for D0 or DIO0
      // Check both possibilities (some XBee modules report as D0, others as DIO0)
      let buttonState;
      if (frame.digitalSamples && frame.digitalSamples.D0 !== undefined) {
        buttonState = frame.digitalSamples.D0;
        if (buttonState === 0) { // Seulement log quand le bouton est appuyé
          console.log(`🔘 BOUTON APPUYÉ - Table ${tableId}`);
        }
        handleButtonForTable(buttonState, tableId, frame.remote64);
      } 
      else if (frame.digitalSamples && frame.digitalSamples.DIO0 !== undefined) {
        buttonState = frame.digitalSamples.DIO0;
        if (buttonState === 0) { // Seulement log quand le bouton est appuyé
          console.log(`🔘 BOUTON APPUYÉ - Table ${tableId}`);
        }
        handleButtonForTable(buttonState, tableId, frame.remote64);
      }
      
      // Traiter les données des capteurs analogiques
      if (analogValueAD2 !== undefined) {
        console.log(`AD2 Value (Table ${tableId}): ${analogValueAD2}`);
        handleSeat(analogValueAD2, mqttClient, `AD2_Table${tableId}`);
      }
    }
  }
});
