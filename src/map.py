import argparse
import requests
import json

request = "https://api.511.org/transit/stops?api_key={api_key}&operator_id=AM&line_id=CC"



if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", type=str, required=True, help="API key")
    parser.add_argument("--verbose", action='store_true', help="Verbose output")
    args = parser.parse_args()

    request_url = request.format(api_key = args.api_key)
    response = requests.get(request_url)
    
    if response.status_code == 200:
        clean_string = response.content.decode("utf-8-sig")
        data = json.loads(clean_string)

        if args.verbose:
            # beautity json display
            pretty_json = json.dumps(data, indent=2)
            print(pretty_json)
    