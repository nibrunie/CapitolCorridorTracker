import argparse
import requests
import xml.etree.ElementTree as ET
import json
from datetime import datetime
from zoneinfo import ZoneInfo

# format template
api_template = "https://api.511.org/transit/{action}?{parameters}"




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
                vehicle_id = journey["VehicleRef"]
                line_ref = journey["LineRef"]
                direction_ref = journey["DirectionRef"]
                train_number = journey["FramedVehicleJourneyRef"]["DatedVehicleJourneyRef"]

                origin_name = journey["OriginName"]
                destination_name = journey["DestinationName"]
                
                location = journey["VehicleLocation"]
                monitored_call = journey["MonitoredCall"]
                onward_calls = journey["OnwardCalls"]["OnwardCall"]
            except KeyError as e:
                print(f"Error: {e}")
                continue

            if monitored_call["VehicleAtStop"]:
                # extracting departure time
                # parse time by converting it to datetime
                expected_departure_time_raw = monitored_call["ExpectedDepartureTime"]
                aimed_departure_time_raw = monitored_call["AimedDepartureTime"]
                
                
                msg = f"currently at the station {monitored_call["StopPointName"]}"
            else:
                msg = f"travelling to {monitored_call["StopPointName"]}"

            # parse the raw departure time
            expected_departure_time = datetime.strptime(expected_departure_time_raw, "%Y-%m-%dT%H:%M:%SZ")
            aimed_departure_time = datetime.strptime(aimed_departure_time_raw, "%Y-%m-%dT%H:%M:%SZ")

            # re-align to UTC timezone
            expected_departure_time = expected_departure_time.replace(tzinfo=ZoneInfo("UTC"))
            aimed_departure_time = aimed_departure_time.replace(tzinfo=ZoneInfo("UTC"))

            # convert time to local timezone
            expected_departure_time_local = expected_departure_time.astimezone(time_zone)
            aimed_departure_time_local = aimed_departure_time.astimezone(time_zone)
            
            # calculate the difference between expected and actual departure time
            departure_diff = expected_departure_time_local - aimed_departure_time_local

            time_msg = f"expected to depart at {expected_departure_time_local.strftime("%H:%M")} ({departure_diff.total_seconds() / 60:.0f} min(s) late)"

            print(f"Train #{train_number}: {origin_name} -> {destination_name}, {msg}, {time_msg}")
            # print(vehicle_id, line_ref, direction_ref, train_number)
            
        # print(data)
        # beautity json display
        # pretty_json = json.dumps(data, indent=2)
        # print(pretty_json)
    else:
        print(f"Failed to fetch XML. Status code: {response.status_code}")
    
    