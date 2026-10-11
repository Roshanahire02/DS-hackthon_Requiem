import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Popup, useMap } from 'react-leaflet';
import { Navigation, Calendar, Clock, AlertTriangle, TrendingUp, Activity } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import './App.css';

const CITIES = {
  Mumbai: {
    name: "Mumbai, MH",
    center: [19.0760, 72.8777],
    zoom: 12,
    routes: [
      { id: "WEH", name: "Western Express Highway", coords: [[19.0500, 72.8400], [19.1200, 72.8550], [19.2100, 72.8600]] },
      { id: "EEH", name: "Eastern Express Highway", coords: [[19.0200, 72.8500], [19.0800, 72.8900], [19.1700, 72.9500]] },
      { id: "JVLR", name: "Jogeshwari-Vikhroli Link Road", coords: [[19.1241, 72.8550], [19.1280, 72.9100]] }
    ]
  },
  Bengaluru: {
    name: "Bengaluru, KA",
    center: [12.9716, 77.5946],
    zoom: 12,
    routes: [
      { id: "ORR", name: "Outer Ring Road (Silk Board)", coords: [[12.9172, 77.6228], [12.9360, 77.6960], [12.9800, 77.6980]] }
    ]
  },
  Delhi: {
    name: "Delhi (NCR)",
    center: [28.6139, 77.2090],
    zoom: 11,
    routes: [
      { id: "RING", name: "Ring Road (AIIMS Corridor)", coords: [[28.5672, 77.2100], [28.5900, 77.2300], [28.6300, 77.2200]] }
    ]
  }
};

function MapRecenter({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

export default function App() {
  const [selectedCityKey, setSelectedCityKey] = useState("Mumbai");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [timeOffset, setTimeOffset] = useState(0);
  const [selectedRouteId, setSelectedRouteId] = useState("WEH");

  const [trafficData, setTrafficData] = useState({
    congestionLevel: "Loading...",
    congestionScore: 0,
    speedKmh: 0,
    vehicleCount: 0,
    forecastTrend: "Connecting to backend pipeline..."
  });

  const activeCity = CITIES[selectedCityKey];

  // Fetch live predictions from FastAPI backend whenever controls change
  useEffect(() => {
    if (!activeCity.routes.find(r => r.id === selectedRouteId)) {
      setSelectedRouteId(activeCity.routes[0].id);
      return;
    }

    // Call FastAPI backend endpoint
    fetch("http://127.0.0.1:8000/forecast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        route_id: selectedRouteId,
        offset_minutes: timeOffset,
        city_name: selectedCityKey,
        weather_condition: "Clear"
      })
    })
      .then(res => res.json())
      .then(data => {
        setTrafficData({
          congestionLevel: data.congestion_level,
          congestionScore: data.congestion_score,
          speedKmh: data.estimated_speed_kmh,
          vehicleCount: data.estimated_vehicle_count,
          forecastTrend: data.forecast_trend
        });
      })
      .catch(err => {
        console.error("Backend connection error:", err);
        setTrafficData(prev => ({
          ...prev,
          forecastTrend: "Backend offline. Ensure uvicorn is running on port 8000."
        }));
      });
  }, [selectedRouteId, timeOffset, selectedCityKey, selectedDate]);

  const getCongestionColor = (level) => {
    switch (level) {
      case "Low": return "#22c55e";
      case "Moderate": return "#eab308";
      case "High": return "#f97316";
      case "Severe": return "#ef4444";
      default: return "#2563eb";
    }
  };

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-title">
          <div className="header-icon-box">
            <Activity className="header-icon" />
          </div>
          <div>
            <h1>Smart Traffic Congestion Forecasting</h1>
            <p>TE/BE Smart City • Real-Time AI Prediction & Context Adaptation Dashboard</p>
          </div>
        </div>
      </header>

      <div className="controls-bar">
        <div className="control-group">
          <label><Navigation size={15} /> Select Location</label>
          <select
            value={selectedCityKey}
            onChange={(e) => setSelectedCityKey(e.target.value)}
            className="control-select"
          >
            {Object.keys(CITIES).map((city) => (
              <option key={city} value={city}>{CITIES[city].name}</option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label><Calendar size={15} /> Select Date (Holiday / Festival Test)</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="control-input"
          />
        </div>

        <div className="control-group">
          <label><Clock size={15} /> Selected Route</label>
          <select
            value={selectedRouteId}
            onChange={(e) => setSelectedRouteId(e.target.value)}
            className="control-select"
          >
            {activeCity.routes.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="main-content">
        <div className="map-wrapper">
          <MapContainer
            center={activeCity.center}
            zoom={activeCity.zoom}
            className="leaflet-map"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapRecenter center={activeCity.center} zoom={activeCity.zoom} />

            {activeCity.routes.map((route) => {
              const isSelected = route.id === selectedRouteId;
              const currentColor = getCongestionColor(trafficData.congestionLevel);

              return (
                <Polyline
                  key={route.id}
                  positions={route.coords}
                  pathOptions={{
                    color: isSelected ? currentColor : '#94a3b8',
                    weight: isSelected ? 8 : 4,
                    opacity: isSelected ? 0.95 : 0.4,
                    dashArray: timeOffset > 0 ? '8, 8' : undefined
                  }}
                  eventHandlers={{
                    click: () => setSelectedRouteId(route.id),
                  }}
                >
                  <Popup>
                    <strong>{route.name}</strong><br />
                    Status: {trafficData.congestionLevel}<br />
                    Mode: {timeOffset === 0 ? "Live" : `+${timeOffset} mins forecast`}
                  </Popup>
                </Polyline>
              );
            })}
          </MapContainer>

          <div className="map-legend">
            <span className="legend-item"><span className="line solid"></span> Current (Solid)</span>
            <span className="legend-item"><span className="line dotted"></span> Forecasted (Dotted)</span>
          </div>
        </div>

        <div className="metrics-card">
          <div className="card-header">
            <h3>Congestion Overview</h3>
            <span className={`status-pill ${trafficData.congestionLevel.toLowerCase()}`}>
              {trafficData.congestionLevel}
            </span>
          </div>

          <div className="meter-container">
            <div className="meter-value" style={{ color: getCongestionColor(trafficData.congestionLevel) }}>
              {trafficData.congestionScore}
              <span className="meter-unit">/100</span>
            </div>
            <p className="meter-label">Congestion Index Score</p>
          </div>

          <div className="stats-grid">
            <div className="stat-box">
              <span className="stat-title">Avg Speed</span>
              <span className="stat-value">{trafficData.speedKmh} km/h</span>
            </div>
            <div className="stat-box">
              <span className="stat-title">Est. Volume</span>
              <span className="stat-value">{trafficData.vehicleCount} vehicles</span>
            </div>
          </div>

          <div className={`forecast-banner ${timeOffset > 0 ? 'active' : ''}`}>
            {timeOffset > 0 ? <TrendingUp size={18} /> : <AlertTriangle size={18} />}
            <p>{trafficData.forecastTrend}</p>
          </div>
        </div>
      </div>

      <footer className="time-controls-footer">
        <span className="time-controls-label">Time Jump Offset:</span>
        <div className="buttons-group">
          {[
            { label: "Current Live", value: 0 },
            { label: "+5 Mins", value: 5 },
            { label: "+15 Mins", value: 15 },
            { label: "+30 Mins", value: 30 }
          ].map((btn) => (
            <button
              key={btn.value}
              className={`time-btn ${timeOffset === btn.value ? 'active' : ''}`}
              onClick={() => setTimeOffset(btn.value)}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}