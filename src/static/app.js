document.addEventListener('DOMContentLoaded', () => {
    const trainsContainer = document.getElementById('trains-container');
    const loadingState = document.getElementById('loading');
    const errorState = document.getElementById('error');
    const updateStatus = document.getElementById('update-status');
    const pulseIndicator = document.getElementById('pulse');

    let refreshIntervalSec = 60; // Default

    let map;
    let trainMarkers = {}; // Store train markers by vehicle_id
    
    let currentTrainsData = [];
    let currentStopsData = [];
    let selectedStationId = null;
    let selectedTrainId = null;
    
    const detailsContainer = document.getElementById('details-container');
    const stationDetailsPane = document.getElementById('station-details');
    const trainDetailsPane = document.getElementById('train-details');
    
    // Initialization
    async function init() {
        const url = new URL(window.location);
        selectedStationId = url.searchParams.get('station');
        selectedTrainId = url.searchParams.get('train');
        if (selectedTrainId) selectedTrainId = parseInt(selectedTrainId);
        
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
        
        // Add OpenStreetMap light-themed tiles (CartoDB Positron)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
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
            
            currentStopsData = stops;
            
            // Create a custom icon for stations
            const stationIcon = L.divIcon({
                className: 'station-marker',
                html: '<div style="width: 10px; height: 10px; background: var(--text-secondary); border-radius: 50%; border: 2px solid var(--bg-color);"></div>',
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });
            
            stops.forEach(stop => {
                if (stop.latitude && stop.longitude) {
                    const marker = L.marker([parseFloat(stop.latitude), parseFloat(stop.longitude)], {icon: stationIcon})
                        .addTo(map);
                    
                    marker.on('click', () => {
                        selectedStationId = stop.id;
                        showStationDetails(stop);
                        updateURLParams();
                    });
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
            currentTrainsData = trains;
            renderTrains(trains);
            updateTrainMarkers(trains);
            
            // Refresh details pane if open
            if (selectedStationId) {
                const stop = currentStopsData.find(s => s.id === selectedStationId);
                if (stop) showStationDetails(stop);
            } else if (selectedTrainId) {
                const train = currentTrainsData.find(t => t.vehicle_id === selectedTrainId);
                if (train) showTrainDetails(train);
                else hideDetailsPane(); // Train might have completed journey
            }
            
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
            
            const trainIcon = L.divIcon({
                className: 'custom-train-marker',
                html: `
                    <div class="train-icon-container">
                        <img src="${iconUrl}" alt="Train" />
                        <span>#${train.train_number}</span>
                    </div>
                `,
                iconSize: [80, 32],
                iconAnchor: [40, 16],
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
            } else {
                // Create new marker
                const marker = L.marker([lat, lng], {icon: trainIcon})
                    .addTo(map);
                
                marker.on('click', () => {
                    selectedTrainId = train.vehicle_id;
                    showTrainDetails(train);
                    updateURLParams();
                });
                
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
            card.onclick = () => {
                selectedTrainId = train.vehicle_id;
                showTrainDetails(train);
                updateURLParams();
                // Optionally scroll to top
                window.scrollTo({ top: 0, behavior: 'smooth' });
            };
            
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

    // Map Details Logic
    function updateURLParams() {
        const url = new URL(window.location);
        if (selectedStationId) url.searchParams.set('station', selectedStationId);
        else url.searchParams.delete('station');
        
        if (selectedTrainId) url.searchParams.set('train', selectedTrainId);
        else url.searchParams.delete('train');
        
        window.history.pushState({}, '', url);
    }

    function checkDetailsContainer() {
        if (!selectedStationId && !selectedTrainId) {
            detailsContainer.classList.add('hidden');
        } else {
            detailsContainer.classList.remove('hidden');
        }
    }

    function hideStationDetails() {
        stationDetailsPane.classList.add('hidden');
        selectedStationId = null;
        checkDetailsContainer();
        updateURLParams();
    }
    
    function hideTrainDetails() {
        trainDetailsPane.classList.add('hidden');
        selectedTrainId = null;
        checkDetailsContainer();
        updateURLParams();
    }
    
    window.hideStationDetails = hideStationDetails;
    window.hideTrainDetails = hideTrainDetails;

    function swapPanes() {
        if (stationDetailsPane.classList.contains('order-first')) {
            stationDetailsPane.classList.remove('order-first');
            stationDetailsPane.classList.add('order-second');
            trainDetailsPane.classList.remove('order-second');
            trainDetailsPane.classList.add('order-first');
        } else {
            stationDetailsPane.classList.remove('order-second');
            stationDetailsPane.classList.add('order-first');
            trainDetailsPane.classList.remove('order-first');
            trainDetailsPane.classList.add('order-second');
        }
    }
    window.swapPanes = swapPanes;

    function showStationDetails(stop) {
        let passingTrains = [];
        currentTrainsData.forEach(train => {
            const calls = train.onward_calls || [];
            const call = calls.find(c => c.stop_point_ref === stop.id || c.stop_point_name === stop.name);
            if (call) {
                passingTrains.push({
                    trainNumber: train.train_number,
                    direction: train.direction_ref === 'N' ? 'Northbound' : (train.direction_ref === 'S' ? 'Southbound' : train.direction_ref),
                    destination: train.destination_name,
                    expectedTime: new Date(call.expected_departure_time),
                    aimedTime: new Date(call.aimed_departure_time)
                });
            }
        });

        passingTrains.sort((a, b) => a.expectedTime - b.expectedTime);

        let rows = passingTrains.map(pt => `
            <tr>
                <td><strong>#${pt.trainNumber}</strong></td>
                <td>${pt.direction}</td>
                <td>${pt.destination}</td>
                <td>${pt.aimedTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                <td><strong>${pt.expectedTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</strong></td>
            </tr>
        `).join('');
        
        if (passingTrains.length === 0) {
            rows = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary);">No upcoming trains found for this station.</td></tr>`;
        }

        stationDetailsPane.innerHTML = `
            <div class="details-header">
                <h2>🚉 ${stop.name} Station</h2>
                <div>
                    <button class="swap-btn" onclick="swapPanes()" title="Swap order">↕</button>
                    <button class="close-btn" onclick="hideStationDetails()">&times;</button>
                </div>
            </div>
            <div class="details-content">
                <table class="details-table">
                    <thead>
                        <tr>
                            <th>Train #</th>
                            <th>Direction</th>
                            <th>Destination</th>
                            <th>Scheduled</th>
                            <th>Expected</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
        if (!stationDetailsPane.classList.contains('order-first') && !stationDetailsPane.classList.contains('order-second')) {
            stationDetailsPane.classList.add('order-first');
            trainDetailsPane.classList.add('order-second');
        }
        stationDetailsPane.classList.remove('hidden');
        detailsContainer.classList.remove('hidden');
    }

    function showTrainDetails(train) {
        const direction = train.direction_ref === 'N' ? 'Northbound' : (train.direction_ref === 'S' ? 'Southbound' : train.direction_ref);
        
        const calls = train.onward_calls || [];
        let rows = calls.map(call => {
            const exp = new Date(call.expected_departure_time);
            const aimed = new Date(call.aimed_departure_time);
            return `
            <tr>
                <td><strong>${call.stop_point_name}</strong></td>
                <td>${aimed.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                <td><strong>${exp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</strong></td>
            </tr>
            `;
        }).join('');
        
        if (calls.length === 0) {
            rows = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary);">No upcoming stops available.</td></tr>`;
        }

        trainDetailsPane.innerHTML = `
            <div class="details-header">
                <h2>🚆 Train #${train.train_number} (${direction})</h2>
                <div>
                    <button class="swap-btn" onclick="swapPanes()" title="Swap order">↕</button>
                    <button class="close-btn" onclick="hideTrainDetails()">&times;</button>
                </div>
            </div>
            <p style="margin-bottom: 1rem; color: var(--text-secondary); font-size: 0.9rem;">
                ${train.origin_name} &rarr; ${train.destination_name} <br/>
                <em>${train.status_message}</em>
            </p>
            <div class="details-content">
                <table class="details-table">
                    <thead>
                        <tr>
                            <th>Upcoming Station</th>
                            <th>Scheduled Arrival</th>
                            <th>Expected Arrival</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
        if (!trainDetailsPane.classList.contains('order-first') && !trainDetailsPane.classList.contains('order-second')) {
            trainDetailsPane.classList.add('order-second');
            stationDetailsPane.classList.add('order-first');
        }
        trainDetailsPane.classList.remove('hidden');
        detailsContainer.classList.remove('hidden');
    }

    // Start
    init();
});
