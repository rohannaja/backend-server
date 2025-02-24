export const convertDecimal128FieldsToString = (data) => {
    if (Array.isArray(data)) {
      return data.map(convertDecimal128FieldsToString);
    }
  
    if (typeof data === "object" && data !== null) {
      const newData = {};
  
      for (const key in data) {
        if (typeof data[key] === "object" && data[key] !== null) {
          if ("$numberDecimal" in data[key]) {
            newData[key] = data[key]["$numberDecimal"]; // Extract the actual number
          } else {
            newData[key] = convertDecimal128FieldsToString(data[key]); // Recursively process objects
          }
        } else {
          newData[key] = data[key];
        }
      }
  
      return newData;
    }
  
    return data;
  }