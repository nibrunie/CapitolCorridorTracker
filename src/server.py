import os
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from main import fetch_train_data

app = FastAPI(title="Capitol Corridor Realtime Tracker")

# Read API Key from environment
API_KEY = os.environ.get("API_KEY")
if not API_KEY:
    print("WARNING: API_KEY environment variable is not set. The API will fail to fetch data.")

# Expose config via an endpoint so the frontend knows the refresh interval
REFRESH_INTERVAL_SEC = int(os.environ.get("REFRESH_INTERVAL_SEC", "60"))


@app.get("/api/config")
def get_config():
    return {"refresh_interval_sec": REFRESH_INTERVAL_SEC}


@app.get("/api/trains")
def get_trains(timezone: str = "America/Los_Angeles"):
    if not API_KEY:
        raise HTTPException(status_code=500, detail="API_KEY is not configured on the server")
    
    try:
        vehicles = fetch_train_data(API_KEY, timezone)
        return [vehicle.to_dict(timezone) for vehicle in vehicles]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

import json

@app.get("/api/stops")
def get_stops():
    try:
        stops_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "AM_CC_stops.json")
        with open(stops_file, "r") as f:
            data = json.load(f)
            
        stops = []
        if "Contents" in data and "dataObjects" in data["Contents"] and "ScheduledStopPoint" in data["Contents"]["dataObjects"]:
            for stop in data["Contents"]["dataObjects"]["ScheduledStopPoint"]:
                stops.append({
                    "id": stop.get("id"),
                    "name": stop.get("Name"),
                    "latitude": stop.get("Location", {}).get("Latitude"),
                    "longitude": stop.get("Location", {}).get("Longitude")
                })
        return stops
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Mount static files to serve the frontend
# The 'html=True' will automatically serve index.html at the root '/'
assets_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets")
if os.path.exists(assets_dir):
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)
    
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
