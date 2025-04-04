const generateRestaurantUrl = require('./sender');

module.exports = function handleSeatSensor(analogSamples, mqttClient, capteurId) {
  const analogValue = analogSamples;

  if (analogValue === undefined) {
    console.error(`⚠️ Aucune valeur analogique trouvée pour le capteur ${capteurId}`);
    return;
  }

  if (!global.seatSensorStates) global.seatSensorStates = {};

  if (!global.seatSensorStates[capteurId]) {
    global.seatSensorStates[capteurId] = {
      isSeated: false // État initial : personne assise
    };
  }

  const state = global.seatSensorStates[capteurId];
  const seatId = capteurId === "AD2" ? 1 : 2;

  console.log(`Valeur reçue pour ${capteurId} : ${analogValue}`); // Debug

  if (analogValue > 0) {
    if (!state.isSeated) {
      state.isSeated = true;
      console.log(`✅ ${capteurId} détecte une personne assise.`);

      mqttClient.publish(generateRestaurantUrl("tables", seatId, "occupied"), "true");
    }
  } else {
    if (state.isSeated) {
      state.isSeated = false;
      console.log(`❌ ${capteurId} détecte que la personne s'est levée.`);

      mqttClient.publish(generateRestaurantUrl("tables", seatId, "occupied"), "false");
    }
  }
}
