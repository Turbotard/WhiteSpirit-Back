const mqtt = require('mqtt');
const config = require('./config');

// Connexion au broker MQTT
const client = mqtt.connect(config.mqtt.brokerUrl, {
  clientId: `test_app_${Date.now()}`
});

// Interface de ligne de commande
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

// Liste des capteurs disponibles
let sensors = config.sensors;

client.on('connect', () => {
  console.log('✅ Connecté au broker MQTT');

  // S'abonner aux topics
  client.subscribe(config.mqtt.topics.sensorData, (err) => {
    if (err) console.error('Erreur de souscription:', err);
  });

  client.subscribe(config.mqtt.topics.moduleStatus, (err) => {
    if (err) console.error('Erreur de souscription:', err);
  });

  showMenu();
});

// Gestion des messages reçus
client.on('message', (topic, message) => {
  const data = JSON.parse(message.toString());

  if (topic === config.mqtt.topics.sensorData) {
    console.log(`\nDonnées reçues du capteur ${data.sensorId}:`);
    console.log(JSON.stringify(data, null, 2));
  } else if (topic === config.mqtt.topics.moduleStatus) {
    if (data.status === 'sensor_availability') {
      sensors = data.sensors;
      console.log('\n=== État du Système ===');
      console.log(`Port série: ${data.serialConnected ? '✅ Connecté' : '❌ Non connecté'}`);
      if (!data.serialConnected) {
        console.log('⚠️  Impossible de vérifier les capteurs sans connexion série');
      }
      showMenu();
    }
  }
});

function showMenu() {
  console.log('\n=== Menu Principal ===');
  console.log('1. Liste des capteurs disponibles');
  console.log('2. Envoyer une commande à un capteur');
  console.log('3. Contrôler un module');
  console.log('4. Voir les données en temps réel');
  console.log('exit - Quitter\n');

  readline.question('Choisissez une option: ', handleMenuChoice);
}

function handleMenuChoice(choice) {
  switch (choice) {
    case '1':
      showSensors();
      break;
    case '2':
      sendSensorCommand();
      break;
    case '3':
      controlModule();
      break;
    case '4':
      showRealtimeData();
      break;
    case 'exit':
      readline.close();
      client.end();
      process.exit(0);
      break;
    default:
      console.log('Option invalide');
      showMenu();
  }
}

function showSensors() {
  console.log('\n=== Capteurs Disponibles ===');
  console.log(`État du port série: ${sensors.serialConnected ? '✅ Connecté' : '❌ Non connecté'}\n`);

  Object.entries(sensors).forEach(([type, sensor]) => {
    if (type !== 'serialConnected') {
      console.log(`\nType: ${type}`);
      console.log(`ID: ${sensor.id}`);
      console.log(`Unité: ${sensor.unit}`);
      if (sensor.available === undefined) {
        console.log('État: ⚠️  Non vérifié');
      } else {
        console.log(`État: ${sensor.available ? '✅ Connecté' : '❌ Non connecté'}`);
      }
      if (sensor.error) {
        console.log(`Erreur: ${sensor.error}`);
      }
      if (sensor.available && sensor.nodeId) {
        console.log(`Nom: ${sensor.nodeId}`);
      }
    }
  });
  showMenu();
}

function sendSensorCommand() {
  console.log('\n=== Envoyer une Commande ===');
  console.log('Capteurs disponibles:');
  Object.entries(sensors).forEach(([type, sensor], index) => {
    console.log(`${index + 1}. ${type} (${sensor.id})`);
  });

  readline.question('\nChoisissez un capteur (numéro): ', (sensorIndex) => {
    const sensorTypes = Object.keys(sensors);
    const selectedType = sensorTypes[parseInt(sensorIndex) - 1];

    if (!selectedType) {
      console.log('Capteur invalide');
      showMenu();
      return;
    }

    const sensor = sensors[selectedType];
    console.log(`\nCommandes disponibles pour ${selectedType}:`);
    console.log(config.commands[selectedType].join(', '));
    console.log('Commandes communes:', config.commands.common.join(', '));

    readline.question('\nEntrez la commande: ', (command) => {
      const message = {
        sensorId: sensor.id,
        command: command.toUpperCase(),
        parameters: []
      };

      client.publish(config.mqtt.topics.sensorCommand, JSON.stringify(message));
      console.log('Commande envoyée');
      showMenu();
    });
  });
}

function controlModule() {
  console.log('\n=== Contrôle de Module ===');
  console.log('Modules disponibles:');
  Object.entries(sensors).forEach(([type, sensor], index) => {
    console.log(`${index + 1}. ${type} (${sensor.id})`);
  });

  readline.question('\nChoisissez un module (numéro): ', (moduleIndex) => {
    const sensorTypes = Object.keys(sensors);
    const selectedType = sensorTypes[parseInt(moduleIndex) - 1];

    if (!selectedType) {
      console.log('Module invalide');
      showMenu();
      return;
    }

    const module = sensors[selectedType];
    console.log('\nActions disponibles:');
    console.log('- RESET');
    console.log('- GET_STATUS');
    console.log('- GET_CONFIG');

    readline.question('\nEntrez l\'action: ', (action) => {
      const message = {
        moduleId: module.id,
        action: action.toUpperCase(),
        parameters: []
      };

      client.publish(config.mqtt.topics.moduleControl, JSON.stringify(message));
      console.log('Commande envoyée');
      showMenu();
    });
  });
}

function showRealtimeData() {
  console.log('\n=== Données en Temps Réel ===');
  console.log('Appuyez sur Ctrl+C pour revenir au menu');

  // S'abonner aux données en temps réel
  const dataHandler = (topic, message) => {
    if (topic === config.mqtt.topics.sensorData) {
      const data = JSON.parse(message.toString());
      console.log('\nNouvelles données reçues:');
      console.log(JSON.stringify(data, null, 2));
    }
  };

  client.on('message', dataHandler);

  // Attendre Ctrl+C
  process.on('SIGINT', () => {
    client.removeListener('message', dataHandler);
    showMenu();
  });
}
