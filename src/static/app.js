document.addEventListener('DOMContentLoaded', () => {
    const trainsContainer = document.getElementById('trains-container');
    const loadingState = document.getElementById('loading');
    const errorState = document.getElementById('error');
    const updateStatus = document.getElementById('update-status');
    const pulseIndicator = document.getElementById('pulse');

    let refreshIntervalSec = 60; // Default

    let map;
    let trainMarkers = {}; // Store train markers by vehicle_id
    
    // Initialization
    async function init() {
        initMap();
        
        try {
            await fetchConfig();
            await fetchStops(); // Load stops first
            await fetchTrains();
            
            // Set up polling
            setInterval(fetchTrains, refreshIntervalSec * 1000);
            
            // Set up countdown timer for UI
            setInterval(updateCountdownUI, 1000);
        } catch (error) {
            showError("Failed to initialize the tracker. Is the server running?");
        }
    }
    
    function initMap() {
        // Initialize map centered roughly around the Bay Area
        map = L.map('map').setView([37.8, -122.2], 8);
        
        // Add OpenStreetMap dark-themed tiles (CartoDB Dark Matter)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(map);
    }
    
    async function fetchStops() {
        try {
            const response = await fetch('/api/stops');
            if (!response.ok) throw new Error("Failed to load stops");
            
            const stops = await response.json();
            
            // Create a custom icon for stations
            const stationIcon = L.divIcon({
                className: 'station-marker',
                html: '<div style="width: 10px; height: 10px; background: var(--text-secondary); border-radius: 50%; border: 2px solid var(--bg-color);"></div>',
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });
            
            stops.forEach(stop => {
                if (stop.latitude && stop.longitude) {
                    L.marker([parseFloat(stop.latitude), parseFloat(stop.longitude)], {icon: stationIcon})
                        .bindPopup(`<h3>${stop.name}</h3>`)
                        .addTo(map);
                }
            });
        } catch (e) {
            console.warn("Could not fetch stops:", e);
        }
    }

    let lastUpdateTime = new Date();

    async function fetchConfig() {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                const config = await response.json();
                if (config.refresh_interval_sec) {
                    refreshIntervalSec = config.refresh_interval_sec;
                }
            }
        } catch (e) {
            console.warn("Could not fetch config, using defaults.");
        }
    }

    async function fetchTrains() {
        setUpdatingStatus(true);
        try {
            const response = await fetch('/api/trains');
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || `Server returned ${response.status}`);
            }
            
            const trains = await response.json();
            renderTrains(trains);
            updateTrainMarkers(trains);
            
            lastUpdateTime = new Date();
            setUpdatingStatus(false);
            errorState.classList.add('hidden');
        } catch (error) {
            showError(`Error fetching data: ${error.message}`);
            setUpdatingStatus(false, true);
        }
    }
    
    function updateTrainMarkers(trains) {
        // Keep track of active train IDs to remove stale ones
        const activeTrainIds = new Set();
        
        trains.forEach(train => {
            activeTrainIds.add(train.vehicle_id);
            const lat = parseFloat(train.location.Latitude);
            const lng = parseFloat(train.location.Longitude);
            
            let iconUrl = '/assets/CC_icon-right.png'; // IB / inbound by default
            const dir = (train.direction_ref || "").toUpperCase();
            if (dir === 'OB' || dir.includes('OUTBOUND') || dir === 'S' || dir === 'W') {
                iconUrl = '/assets/CC_icon-left.png';
            }
            
            const trainIcon = L.icon({
                iconUrl: iconUrl,
                iconSize: [32, 32],
                iconAnchor: [16, 16],
                popupAnchor: [0, -16]
            });
            
            const direction = train.direction_ref === 'N' ? 'Northbound' : (train.direction_ref === 'S' ? 'Southbound' : train.direction_ref);
            const popupContent = `
                <h3>Train #${train.train_number} (${direction})</h3>
                <p><strong>Route:</strong> ${train.origin_name} to ${train.destination_name}</p>
                <p>${train.status_message}</p>
            `;
            
            if (trainMarkers[train.vehicle_id]) {
                // Update existing marker
                trainMarkers[train.vehicle_id].setLatLng([lat, lng]);
                trainMarkers[train.vehicle_id].setIcon(trainIcon);
                trainMarkers[train.vehicle_id].setPopupContent(popupContent);
            } else {
                // Create new marker
                const marker = L.marker([lat, lng], {icon: trainIcon})
                    .bindPopup(popupContent)
                    .addTo(map);
                trainMarkers[train.vehicle_id] = marker;
            }
        });
        
        // Remove markers for trains no longer in the API response
        Object.keys(trainMarkers).forEach(id => {
            if (!activeTrainIds.has(parseInt(id))) {
                map.removeLayer(trainMarkers[id]);
                delete trainMarkers[id];
            }
        });
    }

    function setUpdatingStatus(isUpdating, isError = false) {
        if (isError) {
            pulseIndicator.className = 'pulse-indicator error';
            updateStatus.textContent = 'Update failed';
            return;
        }
        
        if (isUpdating) {
            pulseIndicator.className = 'pulse-indicator updating';
            updateStatus.textContent = 'Updating...';
        } else {
            pulseIndicator.className = 'pulse-indicator';
            updateCountdownUI();
        }
    }

    function updateCountdownUI() {
        if (pulseIndicator.classList.contains('updating') || pulseIndicator.classList.contains('error')) {
            return;
        }
        
        const now = new Date();
        const diffSecs = Math.floor((now - lastUpdateTime) / 1000);
        const nextUpdateIn = Math.max(0, refreshIntervalSec - diffSecs);
        
        updateStatus.textContent = `Updated. Next in ${nextUpdateIn}s`;
    }

    function showError(message) {
        loadingState.classList.add('hidden');
        errorState.textContent = message;
        errorState.classList.remove('hidden');
    }

    function renderTrains(trains) {
        loadingState.classList.add('hidden');
        
        if (trains.length === 0) {
            trainsContainer.innerHTML = `
                <div class="train-card" style="grid-column: 1 / -1; text-align: center;">
                    <p class="status-message">No trains currently active or being monitored.</p>
                </div>
            `;
            return;
        }

        trainsContainer.innerHTML = '';
        
        trains.forEach(train => {
            const card = document.createElement('div');
            card.className = 'train-card';
            
            // Parse direction for better UI
            const direction = train.direction_ref === 'N' ? 'Northbound' : (train.direction_ref === 'S' ? 'Southbound' : train.direction_ref);
            
            let currentStationName = "Unknown Location";
            if (train.monitored_call) {
                currentStationName = train.monitored_call.stop_point_name;
            }

            card.innerHTML = `
                <div class="train-header">
                    <div>
                        <div class="train-id">Train #${train.train_number}</div>
                        <div class="train-route">
                            <span>${train.origin_name}</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                            <span>${train.destination_name}</span>
                        </div>
                    </div>
                    <span class="badge">${direction}</span>
                </div>
                
                <div class="train-status">
                    <div class="station-label">Current Status</div>
                    <div class="status-message">${train.status_message}</div>
                </div>
            `;
            
            trainsContainer.appendChild(card);
        });
    }

    // Start
    init();
});
