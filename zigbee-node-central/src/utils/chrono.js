const generateRestaurantUrl = require('./sender');

module.exports = function handleBac(analogValue, mqttClient, capteurId) {
  // capteurId = "AD0" ou "AD1"
  
  if (!global.timerStates) global.timerStates = {};

  if (!global.timerStates[capteurId]) {
    global.timerStates[capteurId] = {
      countdownTimer: null,
      currentSeconds: 300,
      verrePresent: false,
      compteAReboursTermine: false
    };
  }

  const state = global.timerStates[capteurId];
  const buffetId = capteurId === "AD0" ? 1 : 2;

  if (analogValue > 200) {
    if (!state.verrePresent && !state.compteAReboursTermine) {
      state.verrePresent = true;
      state.currentSeconds = 300;

      console.log(`✅ ${capteurId} détecté, démarrage du compte à rebours...`);

      mqttClient.publish(generateRestaurantUrl("buffet", buffetId, "active"), "true");

      state.countdownTimer = setInterval(() => {
        console.log(`⏳ [${capteurId}] Temps restant : ${state.currentSeconds}s`);
        
        mqttClient.publish(generateRestaurantUrl("buffet", buffetId, "timer"), state.currentSeconds.toString());

        state.currentSeconds--;

        if (state.currentSeconds < 0) {
          console.log(`⏰ [${capteurId}] Temps écoulé`);

          mqttClient.publish(generateRestaurantUrl("buffet", buffetId, "active"), "false");

          clearInterval(state.countdownTimer);
          state.countdownTimer = null;
          state.compteAReboursTermine = true;
        }
      }, 1000);
    }
  } else {
    if (state.verrePresent || state.compteAReboursTermine) {
      console.log(`❌ [${capteurId}] bac retiré, réinitialisation...`);

      mqttClient.publish(generateRestaurantUrl("buffet", buffetId, "active"), "false");

      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
      state.currentSeconds = 300;
      state.verrePresent = false;
      state.compteAReboursTermine = false;
    }
  }
}
