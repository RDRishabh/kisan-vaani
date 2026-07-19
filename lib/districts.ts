// District seed registry for the alert scan + recommendation engine.
// Coordinates are district-HQ approximations; farmer counts are pilot-registry mock values.

export type District = {
  state: string;
  district: string;
  lat: number;
  lon: number;
  farmers: number; // registered farmers in pilot registry (demo)
  crops: string[]; // dominant crops
  blocks: string[]; // representative blocks/tehsils/mandals for zone naming
};

export const DISTRICTS: District[] = [
  { state: "Madhya Pradesh", district: "Sehore", lat: 23.2, lon: 77.08, farmers: 12438, crops: ["Soybean", "Wheat", "Cotton"], blocks: ["Sehore", "Ashta", "Ichhawar", "Nasrullaganj", "Rehti"] },
  { state: "Madhya Pradesh", district: "Vidisha", lat: 23.52, lon: 77.81, farmers: 9812, crops: ["Wheat", "Gram", "Soybean"], blocks: ["Vidisha", "Basoda", "Sironj"] },
  { state: "Telangana", district: "Adilabad", lat: 19.67, lon: 78.53, farmers: 8654, crops: ["Cotton", "Soybean", "Redgram"], blocks: ["Adilabad", "Ichoda", "Boath", "Utnoor"] },
  { state: "Telangana", district: "Warangal", lat: 17.97, lon: 79.59, farmers: 11230, crops: ["Paddy", "Cotton", "Chilli"], blocks: ["Warangal", "Parkal", "Narsampet"] },
  { state: "Telangana", district: "Nalgonda", lat: 17.05, lon: 79.27, farmers: 10440, crops: ["Paddy", "Cotton", "Groundnut"], blocks: ["Nalgonda", "Miryalaguda", "Devarakonda"] },
  { state: "Andhra Pradesh", district: "Guntur", lat: 16.3, lon: 80.44, farmers: 13520, crops: ["Chilli", "Cotton", "Paddy"], blocks: ["Guntur", "Tenali", "Narasaraopet"] },
  { state: "Andhra Pradesh", district: "Anantapur", lat: 14.68, lon: 77.6, farmers: 9975, crops: ["Groundnut", "Redgram", "Maize"], blocks: ["Anantapur", "Kalyandurg", "Dharmavaram"] },
  { state: "Maharashtra", district: "Nashik", lat: 19.99, lon: 73.79, farmers: 14210, crops: ["Grapes", "Onion", "Tomato"], blocks: ["Nashik", "Niphad", "Sinnar", "Yeola"] },
  { state: "Maharashtra", district: "Washim", lat: 20.11, lon: 77.13, farmers: 7230, crops: ["Soybean", "Cotton", "Redgram"], blocks: ["Washim", "Karanja", "Risod"] },
  { state: "Maharashtra", district: "Amravati", lat: 20.93, lon: 77.75, farmers: 10870, crops: ["Cotton", "Soybean", "Orange"], blocks: ["Amravati", "Achalpur", "Morshi"] },
  { state: "Punjab", district: "Ludhiana", lat: 30.9, lon: 75.85, farmers: 11540, crops: ["Wheat", "Paddy", "Maize"], blocks: ["Ludhiana", "Jagraon", "Samrala"] },
  { state: "Haryana", district: "Karnal", lat: 29.69, lon: 76.99, farmers: 8930, crops: ["Paddy", "Wheat", "Sugarcane"], blocks: ["Karnal", "Assandh", "Gharaunda"] },
  { state: "Uttar Pradesh", district: "Muzaffarnagar", lat: 29.47, lon: 77.7, farmers: 12110, crops: ["Sugarcane", "Wheat", "Paddy"], blocks: ["Muzaffarnagar", "Budhana", "Jansath"] },
  { state: "Uttar Pradesh", district: "Gorakhpur", lat: 26.76, lon: 83.37, farmers: 13890, crops: ["Paddy", "Wheat", "Sugarcane"], blocks: ["Gorakhpur", "Campierganj", "Chauri Chaura"] },
  { state: "Uttar Pradesh", district: "Kanpur Dehat", lat: 26.35, lon: 79.97, farmers: 9200, crops: ["Wheat", "Potato", "Mustard"], blocks: ["Pukharayan", "Rura", "Akbarpur"] },
  { state: "Uttar Pradesh", district: "Kanpur Nagar", lat: 26.45, lon: 80.33, farmers: 10100, crops: ["Wheat", "Potato", "Vegetables"], blocks: ["Kanpur", "Bilhaur", "Ghatampur"] },
  { state: "Uttar Pradesh", district: "Lucknow", lat: 26.85, lon: 80.95, farmers: 8800, crops: ["Wheat", "Paddy", "Vegetables"], blocks: ["Lucknow", "Malihabad", "Bakshi Ka Talab"] },
  { state: "Uttar Pradesh", district: "Varanasi", lat: 25.32, lon: 82.97, farmers: 9500, crops: ["Paddy", "Wheat", "Vegetables"], blocks: ["Varanasi", "Pindra", "Cholapur"] },
  { state: "Madhya Pradesh", district: "Shajapur", lat: 23.43, lon: 76.27, farmers: 7600, crops: ["Soybean", "Wheat", "Gram"], blocks: ["Shajapur", "Shujalpur", "Kalapipal"] },
  { state: "Bihar", district: "Patna", lat: 25.59, lon: 85.13, farmers: 9640, crops: ["Paddy", "Wheat", "Maize"], blocks: ["Patna Sadar", "Danapur", "Barh"] },
  { state: "Bihar", district: "Samastipur", lat: 25.86, lon: 85.78, farmers: 11020, crops: ["Paddy", "Maize", "Tobacco"], blocks: ["Samastipur", "Dalsinghsarai", "Rosera"] },
  { state: "West Bengal", district: "Nadia", lat: 23.47, lon: 88.55, farmers: 10450, crops: ["Paddy", "Jute", "Mustard"], blocks: ["Krishnanagar", "Ranaghat", "Tehatta"] },
  { state: "West Bengal", district: "Purba Bardhaman", lat: 23.25, lon: 87.86, farmers: 12780, crops: ["Paddy", "Potato", "Mustard"], blocks: ["Bardhaman", "Kalna", "Katwa"] },
  { state: "Odisha", district: "Cuttack", lat: 20.46, lon: 85.88, farmers: 8210, crops: ["Paddy", "Vegetables", "Jute"], blocks: ["Cuttack Sadar", "Banki", "Athagarh"] },
  { state: "Odisha", district: "Kalahandi", lat: 19.91, lon: 83.16, farmers: 7580, crops: ["Paddy", "Cotton", "Maize"], blocks: ["Bhawanipatna", "Dharamgarh", "Junagarh"] },
  { state: "Karnataka", district: "Belagavi", lat: 15.85, lon: 74.5, farmers: 13340, crops: ["Sugarcane", "Soybean", "Maize"], blocks: ["Belagavi", "Gokak", "Athani"] },
  { state: "Karnataka", district: "Mandya", lat: 12.52, lon: 76.9, farmers: 9110, crops: ["Sugarcane", "Paddy", "Ragi"], blocks: ["Mandya", "Maddur", "Malavalli"] },
  { state: "Tamil Nadu", district: "Thanjavur", lat: 10.79, lon: 79.14, farmers: 10230, crops: ["Paddy", "Blackgram", "Banana"], blocks: ["Thanjavur", "Kumbakonam", "Pattukkottai"] },
  { state: "Tamil Nadu", district: "Madurai", lat: 9.93, lon: 78.12, farmers: 8760, crops: ["Paddy", "Cotton", "Chilli"], blocks: ["Madurai East", "Melur", "Usilampatti"] },
  { state: "Kerala", district: "Palakkad", lat: 10.78, lon: 76.65, farmers: 6890, crops: ["Paddy", "Coconut", "Vegetables"], blocks: ["Palakkad", "Chittur", "Ottapalam"] },
  { state: "Gujarat", district: "Rajkot", lat: 22.3, lon: 70.8, farmers: 11670, crops: ["Groundnut", "Cotton", "Cumin"], blocks: ["Rajkot", "Gondal", "Jetpur"] },
  { state: "Gujarat", district: "Sabarkantha", lat: 23.85, lon: 72.99, farmers: 8340, crops: ["Maize", "Wheat", "Groundnut"], blocks: ["Himatnagar", "Idar", "Prantij"] },
  { state: "Rajasthan", district: "Jodhpur", lat: 26.24, lon: 73.02, farmers: 7450, crops: ["Bajra", "Moong", "Cumin"], blocks: ["Jodhpur", "Bilara", "Phalodi"] },
  { state: "Rajasthan", district: "Sri Ganganagar", lat: 29.92, lon: 73.88, farmers: 10980, crops: ["Wheat", "Cotton", "Mustard"], blocks: ["Sri Ganganagar", "Suratgarh", "Anupgarh"] },
  { state: "Jharkhand", district: "Ranchi", lat: 23.34, lon: 85.31, farmers: 6540, crops: ["Paddy", "Vegetables", "Maize"], blocks: ["Ranchi", "Bundu", "Khunti"] },
  { state: "Chhattisgarh", district: "Raipur", lat: 21.25, lon: 81.63, farmers: 9870, crops: ["Paddy", "Gram", "Vegetables"], blocks: ["Raipur", "Arang", "Abhanpur"] },
  { state: "Assam", district: "Dibrugarh", lat: 27.47, lon: 94.91, farmers: 5980, crops: ["Tea", "Paddy", "Mustard"], blocks: ["Dibrugarh East", "Chabua", "Naharkatia"] },
  { state: "Andhra Pradesh", district: "West Godavari", lat: 16.71, lon: 81.1, farmers: 12960, crops: ["Paddy", "Redgram", "Maize"], blocks: ["Bhimavaram", "Tadepalligudem", "Tanuku"] },
];
