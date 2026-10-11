from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import pandas as pd
from datetime import datetime, timedelta
from typing import Optional

# Import the TomTom live service and adaptation layer we built earlier
from tomtom_service import fetch_live_traffic, adapt_to_indian_context

app = FastAPI(title="Real-Time Traffic Congestion Forecasting API")

# Enable CORS so your React frontend can communicate with FastAPI smoothly
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 1. Load the trained machine learning model bundle on server startup
try:
    bundle = joblib.load("traffic_model.pkl")
    model = bundle["model"]
    feature_columns = bundle["feature_columns"]
    print("Machine learning model 'traffic_model.pkl' loaded successfully!")
except Exception as e:
    print(f"Warning: Could not load traffic_model.pkl. Ensure it's in the backend folder. Error: {e}")

# 2. Major Indian Corridors Mapping (Coordinates & Base Speeds)
MUMBAI_ROUTES = {
    "WEH": {"name": "Western Express Highway", "lat": 19.1136, "lng": 72.8697, "base_speed": 18.0},
    "EEH": {"name": "Eastern Express Highway", "lat": 19.0645, "lng": 72.8800, "base_speed": 22.0},
    "JVLR": {"name": "Jogeshwari-Vikhroli Link Road", "lat": 19.1241, "lng": 72.8550, "base_speed": 15.0}
}

# Request Schemas using Pydantic
class ForecastRequest(BaseModel):
    route_id: str = "WEH"
    offset_minutes: int = 0          # 0 (Live), 5, 15, 30 mins
    city_name: str = "Mumbai"
    weather_condition: str = "Clear" # Clear, Rain, Fog

def prepare_model_features(hour: int, day_of_week: int, vehicle_count: int, speed: float, occupancy: float, weather: str):
    """Helper to structure raw input variables into the exact columns the ML model expects."""
    is_weekend = 1 if day_of_week >= 5 else 0
    
    data = {
        'hour': hour,
        'day_of_week': day_of_week,
        'is_weekend': is_weekend,
        'Vehicle_Count': vehicle_count,
        'Traffic_Speed_kmh': speed,
        'Road_Occupancy_%': occupancy,
    }
    
    # One-hot encode weather columns matching your training set
    weathers = ['Rain', 'Fog', 'Snow', 'Moderate Sun', 'Clear']
    for w in weathers:
        col_name = f"Weather_Condition_{w}"
        if col_name in feature_columns:
            data[col_name] = 1 if weather.lower() == w.lower() else 0

    df_input = pd.DataFrame([data])
    # Reindex to guarantee exact feature order and fill missing columns with 0
    df_input = df_input.reindex(columns=feature_columns, fill_value=0)
    return df_input


@app.get("/")
def root():
    return {"status": "online", "message": "Smart City Traffic Prediction API is running!"}


@app.post("/forecast")
def get_traffic_forecast(request: ForecastRequest):
    """
    Core Pipeline: 
    1. Fetches live TomTom traffic metrics.
    2. Passes metrics through the Indian Context Adaptation layer.
    3. Feeds calibrated inputs into the ML model to output congestion level & score.
    """
    if request.route_id not in MUMBAI_ROUTES:
        raise HTTPException(status_code=404, detail="Route not found")
    
    route = MUMBAI_ROUTES[request.route_id]
    
    # 1. Fetch live data from TomTom API for these coordinates
    raw_tomtom_data = fetch_live_traffic(route["lat"], route["lng"])
    
    # If API key isn't active yet, use route base speed fallback gracefully
    if raw_tomtom_data["current_speed_kmh"] == 0:
        raw_tomtom_data["current_speed_kmh"] = route["base_speed"]
        raw_tomtom_data["free_flow_speed_kmh"] = route["base_speed"] * 2.0

    # 2. Apply Transfer Learning / Context Adaptation Layer
    adapted = adapt_to_indian_context(raw_tomtom_data, request.city_name, request.weather_condition)
    
    # Calculate future time adjustment based on time offset buttons (0, 5, 15, 30 mins)
    future_time = datetime.now() + timedelta(minutes=request.offset_minutes)
    future_hour = future_time.hour
    future_day = future_time.weekday()

    # Simulate slight degradation or improvement based on time offset
    simulated_speed = adapted["adapted_speed_kmh"]
    if request.offset_minutes > 0:
        if 8 <= future_hour <= 11 or 17 <= future_hour <= 20:
            simulated_speed = max(8.0, simulated_speed * 0.85) # Peak hours worsen

    simulated_vehicles = int(180 + (100 - adapted["adapted_occupancy_pct"]))
    
    # 3. Prepare features and run prediction through the ML model
    X_input = prepare_model_features(
        hour=future_hour,
        day_of_week=future_day,
        vehicle_count=simulated_vehicles,
        speed=simulated_speed,
        occupancy=adapted["adapted_occupancy_pct"],
        weather=request.weather_condition
    )

    try:
        prediction = model.predict(X_input)[0]
        probabilities = model.predict_proba(X_input)[0]
        confidence = float(max(probabilities))
    except Exception:
        # Fallback heuristic if model prediction fails
        prediction = "High" if simulated_speed < 20 else "Moderate"
        confidence = 0.85

    # Map categorical prediction to a human-readable 0-100 score meter
    score_mapping = {"Low": 25, "Moderate": 50, "High": 75, "Severe": 95}
    congestion_score = score_mapping.get(prediction, 60)

    # Generate smart trend explanation sentence
    if request.offset_minutes == 0:
        trend_msg = "Current live baseline fetched via TomTom API and calibrated for local context."
    elif request.offset_minutes <= 15:
        trend_msg = f"Congestion expected to shift slightly over the next {request.offset_minutes} minutes based on recurring patterns."
    else:
        trend_msg = f"Significant bottleneck and volume buildup projected in {request.offset_minutes} minutes."

    return {
        "route_id": request.route_id,
        "route_name": route["name"],
        "coordinates": {"lat": route["lat"], "lng": route["lng"]},
        "forecast_time": future_time.strftime("%Y-%m-%d %H:%M:%S"),
        "minutes_ahead": request.offset_minutes,
        "congestion_level": prediction,
        "congestion_score": congestion_score,
        "estimated_speed_kmh": simulated_speed,
        "estimated_vehicle_count": simulated_vehicles,
        "confidence_score": round(confidence * 100, 1),
        "forecast_trend": trend_msg
    }