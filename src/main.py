import argparse
import requests
import xml.etree.ElementTree as ET
import json
from datetime import datetime
from zoneinfo import ZoneInfo

# format template
api_template = "https://api.511.org/transit/{action}?{parameters}"


class VehicleStop:
    """ Class for representing a vehicle stop"""
    def __init__(self, stop_point_ref: str, stop_point_name: str, at_stop: bool, expected_departure_time: datetime, aimed_departure_time: datetime, expected_arrival_time: datetime = None, aimed_arrival_time: datetime = None):
        self.stop_point_ref = stop_point_ref
        self.stop_point_name = stop_point_name
        self.at_stop = at_stop
        self.expected_departure_time = expected_departure_time
        self.aimed_departure_time = aimed_departure_time
        self.expected_arrival_time = expected_arrival_time
        self.aimed_arrival_time = aimed_arrival_time

    def to_dict(self):
        return {
            "stop_point_ref": self.stop_point_ref,
            "stop_point_name": self.stop_point_name,
            "at_stop": self.at_stop,
            "expected_departure_time": self.expected_departure_time.isoformat() if self.expected_departure_time else None,
            "aimed_departure_time": self.aimed_departure_time.isoformat() if self.aimed_departure_time else None,
            "expected_arrival_time": self.expected_arrival_time.isoformat() if self.expected_arrival_time else None,
            "aimed_arrival_time": self.aimed_arrival_time.isoformat() if self.aimed_arrival_time else None
        }

    @classmethod
    def from_vehicle_stop(cls, vehicle_stop):
        stop_point_ref = vehicle_stop["StopPointRef"]
        stop_point_name = vehicle_stop["StopPointName"]
        try:
            at_stop = vehicle_stop["VehicleAtStop"]
        except KeyError:
            at_stop = False

        # Parsing time and re-aligning to UTC timezone (used in encodings)
        def parse_time(key):
            val = vehicle_stop.get(key)
            if val:
                return datetime.strptime(val, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=ZoneInfo("UTC"))
            return None

        expected_departure_time = parse_time("ExpectedDepartureTime")
        aimed_departure_time = parse_time("AimedDepartureTime")
        expected_arrival_time = parse_time("ExpectedArrivalTime")
        aimed_arrival_time = parse_time("AimedArrivalTime")

        return cls(
            stop_point_ref = stop_point_ref,
            stop_point_name = stop_point_name,
            at_stop = at_stop,
            expected_departure_time = expected_departure_time,
            aimed_departure_time = aimed_departure_time,
            expected_arrival_time = expected_arrival_time,
            aimed_arrival_time = aimed_arrival_time
        )
    

class Vehicle:
    """ Class for representing a vehicle"""
    def __init__(self, vehicle_id: int, line_ref: str, direction_ref: str, train_number: str, origin_name: str, destination_name: str, location: dict, monitored_call: VehicleStop, onward_calls: list[VehicleStop]):
        self.vehicle_id = vehicle_id
        self.line_ref = line_ref
        self.direction_ref = direction_ref
        self.train_number = train_number
        self.origin_name = origin_name
        self.destination_name = destination_name
        self.location = location
        self.monitored_call = monitored_call
        self.onward_calls = onward_calls

    def to_dict(self, timezone_str="America/Los_Angeles"):
        return {
            "vehicle_id": self.vehicle_id,
            "line_ref": self.line_ref,
            "direction_ref": self.direction_ref,
            "train_number": self.train_number,
            "origin_name": self.origin_name,
            "destination_name": self.destination_name,
            "location": self.location,
            "monitored_call": self.monitored_call.to_dict() if self.monitored_call else None,
            "onward_calls": [call.to_dict() for call in self.onward_calls],
            "status_message": self.generate_status_message(ZoneInfo(timezone_str))
        }


    def generate_status_message(self, time_zone):
        
        if self.monitored_call.at_stop:
            msg = f"currently at the station {self.monitored_call.stop_point_name}"
        else:
            msg = f"travelling to {self.monitored_call.stop_point_name}"

        departure_diff_str = (self.monitored_call.expected_departure_time.astimezone(time_zone) - self.monitored_call.aimed_departure_time.astimezone(time_zone)).total_seconds() / 60

        expected_departure_time_str = self.monitored_call.expected_departure_time.astimezone(time_zone).strftime("%H:%M %p")

        if departure_diff_str == 0:
            time_msg = f"expected to depart at {expected_departure_time_str}"
        else:
            departure_diff_msg = f"{'late' if departure_diff_str > 0 else 'early'}"
            time_msg = f"scheduled to depart at {self.monitored_call.aimed_departure_time.astimezone(time_zone).strftime('%H:%M %p')} but expected to depart at {expected_departure_time_str} ({abs(departure_diff_str):.0f} min(s) {departure_diff_msg})"

        return f"Train #{self.train_number}: {self.origin_name} -> {self.destination_name}, {msg}, {time_msg}"


    @classmethod
    def from_vehicle_activity(cls, vehicle_activity):
        vehicle = vehicle_activity["MonitoredVehicleJourney"]

        vehicle_id = vehicle["VehicleRef"]
        line_ref = vehicle["LineRef"]
        direction_ref = vehicle["DirectionRef"]
        train_number = vehicle["FramedVehicleJourneyRef"]["DatedVehicleJourneyRef"]

        origin_name = vehicle["OriginName"]
        destination_name = vehicle["DestinationName"]
        
        location = vehicle["VehicleLocation"]
        monitored_call = VehicleStop.from_vehicle_stop(vehicle["MonitoredCall"])
        onward_calls = [VehicleStop.from_vehicle_stop(stop) for stop in vehicle["OnwardCalls"]["OnwardCall"]]

        return cls(
            vehicle_id = int(vehicle_id),
            line_ref = line_ref,
            direction_ref = direction_ref,
            train_number = train_number,
            origin_name = origin_name,
            destination_name = destination_name,
            location = location,
            monitored_call = monitored_call,
            onward_calls = onward_calls
        )
    

def fetch_train_data(api_key: str, timezone_str: str = "America/Los_Angeles") -> list[Vehicle]:
    parameters = "agency=AM&api_key={}".format(api_key)
    
    request_url = api_template.format(
        action = "VehicleMonitoring",
        parameters = parameters
    )
    
    response = requests.get(request_url)
    vehicles = []
    
    if response.status_code == 200:
        clean_string = response.content.decode("utf-8-sig")
        data = json.loads(clean_string)
        
        # safely get the vehicle activities in case of API failure or missing keys
        try:
            vehicle_activities = data["Siri"]["ServiceDelivery"]["VehicleMonitoringDelivery"]["VehicleActivity"]
        except KeyError:
            vehicle_activities = []
            
        for vehicle_activity in vehicle_activities:
            try:
                vehicles.append(Vehicle.from_vehicle_activity(vehicle_activity))
            except KeyError as e:
                print(f"Error parsing vehicle: {e}")
                continue
    else:
        print(f"Failed to fetch XML. Status code: {response.status_code}")
        
    return vehicles


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", type=str, required=True)
    parser.add_argument("--timezone", type=str, default="America/Los_Angeles")
    args = parser.parse_args()

    parameters = "agency=AM&api_key={}".format(args.api_key)
    time_zone = ZoneInfo(args.timezone)

    request_url = api_template.format(
        action = "VehicleMonitoring",
        parameters = parameters
    )

    print(request_url)

    # accessing data by retrieving the response
    # 2. Fetch the XML content from the URL
    response = requests.get(request_url)


    # 3. Ensure the request was successful
    if response.status_code == 200:
        clean_string = response.content.decode("utf-8-sig")
        data = json.loads(clean_string)

        vehicle_activites = data["Siri"]["ServiceDelivery"]["VehicleMonitoringDelivery"]["VehicleActivity"]

        for vehicle in vehicle_activites:
            pretty_json = json.dumps(vehicle, indent=2)
            # print(pretty_json)
            journey = vehicle["MonitoredVehicleJourney"]
            try:
                vehicle = Vehicle.from_vehicle_activity(vehicle)
            except KeyError as e:
                print(f"Error: {e}")
                continue

            print(vehicle.generate_status_message(time_zone))

            
        # beautity json display
        # pretty_json = json.dumps(data, indent=2)
        # print(pretty_json)
    else:
        print(f"Failed to fetch XML. Status code: {response.status_code}")
    
    