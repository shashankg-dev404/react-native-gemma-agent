import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import type { SkillManifest } from '../src/types';

// --- Offline city database (haversine nearest-match) ---

type City = [string, string, string, number, number];
// [city, state/region, country, lat, lng]

const CITIES: City[] = [
  // India
  ['Jodhpur', 'Rajasthan', 'India', 26.2389, 72.9668],
  ['Jaipur', 'Rajasthan', 'India', 26.9124, 75.7873],
  ['Udaipur', 'Rajasthan', 'India', 24.5854, 73.7125],
  ['Jaisalmer', 'Rajasthan', 'India', 26.9157, 70.9083],
  ['Ajmer', 'Rajasthan', 'India', 26.4499, 74.6399],
  ['Mumbai', 'Maharashtra', 'India', 19.0760, 72.8777],
  ['Delhi', 'Delhi', 'India', 28.6139, 77.2090],
  ['Bangalore', 'Karnataka', 'India', 12.9716, 77.5946],
  ['Hyderabad', 'Telangana', 'India', 17.3850, 78.4867],
  ['Chennai', 'Tamil Nadu', 'India', 13.0827, 80.2707],
  ['Kolkata', 'West Bengal', 'India', 22.5726, 88.3639],
  ['Pune', 'Maharashtra', 'India', 18.5204, 73.8567],
  ['Ahmedabad', 'Gujarat', 'India', 23.0225, 72.5714],
  ['Surat', 'Gujarat', 'India', 21.1702, 72.8311],
  ['Lucknow', 'Uttar Pradesh', 'India', 26.8467, 80.9462],
  ['Kanpur', 'Uttar Pradesh', 'India', 26.4499, 80.3319],
  ['Nagpur', 'Maharashtra', 'India', 21.1458, 79.0882],
  ['Indore', 'Madhya Pradesh', 'India', 22.7196, 75.8577],
  ['Bhopal', 'Madhya Pradesh', 'India', 23.2599, 77.4126],
  ['Patna', 'Bihar', 'India', 25.6093, 85.1376],
  ['Chandigarh', 'Chandigarh', 'India', 30.7333, 76.7794],
  ['Guwahati', 'Assam', 'India', 26.1445, 91.7362],
  ['Kochi', 'Kerala', 'India', 9.9312, 76.2673],
  ['Coimbatore', 'Tamil Nadu', 'India', 11.0168, 76.9558],
  ['Varanasi', 'Uttar Pradesh', 'India', 25.3176, 83.0064],
  ['Amritsar', 'Punjab', 'India', 31.6340, 74.8723],
  ['Agra', 'Uttar Pradesh', 'India', 27.1767, 78.0081],
  ['Dehradun', 'Uttarakhand', 'India', 30.3165, 78.0322],
  ['Goa', 'Goa', 'India', 15.2993, 74.1240],
  ['Thiruvananthapuram', 'Kerala', 'India', 8.5241, 76.9366],
  // Global
  ['New York', 'NY', 'USA', 40.7128, -74.0060],
  ['San Francisco', 'CA', 'USA', 37.7749, -122.4194],
  ['Los Angeles', 'CA', 'USA', 34.0522, -118.2437],
  ['Chicago', 'IL', 'USA', 41.8781, -87.6298],
  ['London', '', 'UK', 51.5074, -0.1278],
  ['Paris', '', 'France', 48.8566, 2.3522],
  ['Berlin', '', 'Germany', 52.5200, 13.4050],
  ['Tokyo', '', 'Japan', 35.6762, 139.6503],
  ['Beijing', '', 'China', 39.9042, 116.4074],
  ['Shanghai', '', 'China', 31.2304, 121.4737],
  ['Singapore', '', 'Singapore', 1.3521, 103.8198],
  ['Dubai', '', 'UAE', 25.2048, 55.2708],
  ['Sydney', 'NSW', 'Australia', -33.8688, 151.2093],
  ['Toronto', 'ON', 'Canada', 43.6532, -79.3832],
  ['Seoul', '', 'South Korea', 37.5665, 126.9780],
  ['Bangkok', '', 'Thailand', 13.7563, 100.5018],
  ['Istanbul', '', 'Turkey', 41.0082, 28.9784],
  ['Moscow', '', 'Russia', 55.7558, 37.6173],
  ['São Paulo', '', 'Brazil', -23.5505, -46.6333],
  ['Mexico City', '', 'Mexico', 19.4326, -99.1332],
  ['Cairo', '', 'Egypt', 30.0444, 31.2357],
  ['Lagos', '', 'Nigeria', 6.5244, 3.3792],
  ['Nairobi', '', 'Kenya', -1.2921, 36.8219],
  ['Karachi', 'Sindh', 'Pakistan', 24.8607, 67.0011],
  ['Lahore', 'Punjab', 'Pakistan', 31.5497, 74.3436],
  ['Dhaka', '', 'Bangladesh', 23.8103, 90.4125],
  ['Colombo', '', 'Sri Lanka', 6.9271, 79.8612],
  ['Kathmandu', '', 'Nepal', 27.7172, 85.3240],
  ['Amsterdam', '', 'Netherlands', 52.3676, 4.9041],
  ['Barcelona', '', 'Spain', 41.3874, 2.1686],
  ['Rome', '', 'Italy', 41.9028, 12.4964],
];

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestCity(
  lat: number,
  lng: number,
): { name: string; distKm: number } | null {
  let best: { name: string; distKm: number } | null = null;

  for (const [city, region, country, cLat, cLng] of CITIES) {
    const d = haversineKm(lat, lng, cLat, cLng);
    if (!best || d < best.distKm) {
      const parts = [city, region, country].filter(Boolean);
      best = { name: parts.join(', '), distKm: d };
    }
  }

  // Only return if within 50km of a known city
  return best && best.distKm <= 50 ? best : null;
}

// --- Skill ---

export const deviceLocationSkill: SkillManifest = {
  name: 'device_location',
  description:
    'Get the current GPS location of the device including the city/area name. Works completely offline.',
  version: '1.2.0',
  type: 'native',
  requiresNetwork: false,
  parameters: {},
  requiredParameters: [],
  instructions:
    'Use this when the user asks where they are, their current location, or anything about their physical position. No parameters needed. IMPORTANT: Always include ALL details from the result in your response — location name, coordinates, accuracy, and altitude. Do not summarize or omit fields.',
  execute: async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission',
            message: 'This app needs access to your location.',
            buttonPositive: 'OK',
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          return { error: 'Location permission denied by user.' };
        }
      }

      const position = await new Promise<{
        coords: {
          latitude: number;
          longitude: number;
          altitude: number | null;
          accuracy: number;
          speed: number | null;
        };
      }>((resolve, reject) => {
        Geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 60000,
        });
      });

      const { latitude, longitude, accuracy, altitude } = position.coords;

      // Offline city lookup — no internet needed
      const nearest = findNearestCity(latitude, longitude);

      const parts: string[] = [];
      if (nearest) {
        parts.push(`Location: ${nearest.name}`);
      }
      parts.push(
        `Coordinates: ${latitude.toFixed(6)}°N, ${longitude.toFixed(6)}°E`,
      );
      parts.push(`Accuracy: ${Math.round(accuracy)}m`);
      if (altitude !== null) {
        parts.push(`Altitude: ${Math.round(altitude)}m`);
      }

      return { result: parts.join('\n') };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to get location';
      return { error: `Location error: ${msg}` };
    }
  },
};
