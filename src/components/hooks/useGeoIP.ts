"use client";
import { useEffect, useState } from "react";

export interface GeoJSResult {
  accuracy: number; // 5
  area_code: string; // "0"
  asn: number; // 5089
  city: string; // "London"
  continent_code: string; // "EU"
  country: string; // "United Kingdom"
  country_code: string; // "GB"
  country_code3: string; // "GBR"
  ip: string; // "81.14.126.349"
  latitude: number; // 51.5245
  longitude: number; // -0.1567
  organization: string; // "AS5089 Virgin Media Limited"
  organization_name: string; // "Virgin Media Limited"
  region: string; // "England"
  timezone: string; // "Europe/London"
}

export default function useGeoIP() {
  const [geoData, setGeoData] = useState<GeoJSResult | null>(null);

  useEffect(() => {
    fetch("https://get.geojs.io/v1/ip/geo.json")
      .then((response) => response.json())
      .then((json) => {
        json.latitude = Number(json.latitude);
        json.longitude = Number(json.longitude);
        setGeoData(json);
      });
  }, []);

  return geoData;
}
