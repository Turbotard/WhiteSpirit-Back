module.exports = function generateRestaurantUrl(type, id, option) {
    return `restaurant/${type}/${id}/${option}`;
  }


  //type : tables ou buffet
  //id: numéro de table ou du baque
  // option : détail de du mqtt

/*

restaurant/tables/{id_table}/ready_to_order
restaurant/tables/{id_table}/order_ready
restaurant/tables/{id_table}/bill_request
restaurant/tables/{id_table}/active
restaurant/tables/{id_table}/departure_detected
restaurant/buffet/{id_bac}/timer
restaurant/buffet/{id_bac}/weight
restaurant/buffet/{id_bac}/refill_needed
restaurant/buffet/{id_bac}/temperature

*/