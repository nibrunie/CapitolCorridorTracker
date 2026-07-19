from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
import json
import os
from zoneinfo import ZoneInfo


from src.main import fetch_train_data

app = FastAPI(title="Capitol Corridor Realtime Tracker")

# Read API Key from environment
API_KEY = os.environ.get("API_KEY")
if not API_KEY:
    print("[WARNING]: API_KEY environment variable is not set. The API will fail to fetch data.")


TIMEZONE_STR = os.environ.get("TIMEZONE_STR", "America/Los_Angeles")

# Expose config via an endpoint so the frontend knows the refresh interval
REFRESH_INTERVAL_SEC = int(os.environ.get("REFRESH_INTERVAL_SEC", "60"))


print(f"[LOG]: TIMEZONE_STR={TIMEZONE_STR}")
print(f"[LOG]: REFRESH_INTERVAL_SEC={REFRESH_INTERVAL_SEC}")

last_train_data = fetch_train_data(API_KEY, TIMEZONE_STR) 
last_retrieval_time = datetime.now(ZoneInfo(TIMEZONE_STR))

# retrieve train data
# To rate limit our use of the API, the data are cached locally in the instanced
# and only retrieve if the last retrieval was longer than REFRESH_INTERVAL_SEC ago
def get_train_data():
    global last_train_data, last_retrieval_time
    
    if not API_KEY:
        raise Exception("API_KEY is not configured on the server")

    now = datetime.now(ZoneInfo(TIMEZONE_STR))

    if now - last_retrieval_time < timedelta(seconds=REFRESH_INTERVAL_SEC):
        return last_train_data
    else:
        last_train_data = fetch_train_data(API_KEY, TIMEZONE_STR)
        last_retrieval_time = now
        return last_train_data


@app.get("/api/config")
def get_config():
    return {"refresh_interval_sec": REFRESH_INTERVAL_SEC}


@app.get("/api/last_update")
def get_last_update():
    return {"last_update": last_retrieval_time.isoformat()}


@app.get("/api/trains")
def get_trains(timezone: str = "America/Los_Angeles"):
    if not API_KEY:
        raise HTTPException(status_code=500, detail="API_KEY is not configured on the server")
    
    try:
        vehicles = get_train_data()
        return [vehicle.to_dict(timezone) for vehicle in vehicles]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
