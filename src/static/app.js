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
    
    let callNameToId = {};
    let idToCallName = {};
    let initialStationParam = null;
    let initialTrainParam = null;
    
    const detailsContainer = document.getElementById('details-container');
    const stationDetailsPane = document.getElementById('station-details');
    const trainDetailsPane = document.getElementById('train-details');
    
    // Initialization
    async function init() {
        const url = new URL(window.location);
        initialStationParam = url.searchParams.get('station');
        initialTrainParam = url.searchParams.get('train');
        
        initMap();
        
        try {
            await fetchConfig();
            
            if (initialStationParam) {
                if (callNameToId[initialStationParam]) {
                    selectedStationId = callNameToId[initialStationParam].toString();
                } else {
                    selectedStationId = initialStationParam;
                }
            }
            
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
    
    function centerMapBayArea() {
        if (map) {
            map.setView([37.8, -122.13], 9);
        }
    }
    
    function centerMapAll() {
        if (map && currentStopsData && currentStopsData.length > 0) {
            const validStops = currentStopsData.filter(s => s.latitude && s.longitude);
            if (validStops.length > 0) {
                const bounds = L.latLngBounds(validStops.map(stop => [parseFloat(stop.latitude), parseFloat(stop.longitude)]));
                map.fitBounds(bounds, { padding: [30, 30] });
            }
        }
    }
    
    // Attach to window so onclick works in HTML
    window.centerMapBayArea = centerMapBayArea;
    window.centerMapAll = centerMapAll;
    
    async function fetchStops() {
        try {
            const response = await fetch('/api/stops');
            if (!response.ok) throw new Error("Failed to load stops");
            
            const stops = await response.json();
            
            currentStopsData = stops;
            
            // Create a custom icon for stations
            const stationIcon = L.divIcon({
                className: 'station-marker',
                html: '<div style="width: 10px; height: 10px; background: var(--text-secondary); border-radius: 50%; border: 2px solid var(--bg-color); z-index: 200;"></div>',
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });
            
            stops.forEach(stop => {
                if (stop.latitude && stop.longitude) {
                    const marker = L.marker([parseFloat(stop.latitude), parseFloat(stop.longitude)], {icon: stationIcon})
                        .addTo(map);
                    
                    marker.on('click', () => {
                        openStation(stop.id);
                    });
                }
            });
        } catch (e) {
            console.warn("Could not fetch stops:", e);
        }
    }

    let lastUpdateTime = new Date();
    let serverTimezone = "America/Los_Angeles";

    async function fetchConfig() {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                const config = await response.json();
                if (config.refresh_interval_sec) {
                    refreshIntervalSec = config.refresh_interval_sec;
                }
                if (config.timezone) {
                    serverTimezone = config.timezone;
                }
                if (config.version) {
                    const versionEl = document.getElementById('app-version');
                    if (versionEl) versionEl.textContent = `| ${config.version}`;
                }
                if (config.station_call_name_to_id) {
                    callNameToId = config.station_call_name_to_id;
                    Object.entries(callNameToId).forEach(([callName, id]) => {
                        idToCallName[id] = callName;
                    });
                }
            }
        } catch (e) {
            console.warn("Could not fetch config, using defaults.");
        }
    }

    async function fetchTrains() {
        setUpdatingStatus(true);
        try {
            const [trainsRes, updateRes] = await Promise.all([
                fetch('/api/trains'),
                fetch('/api/last_update')
            ]);
            
            if (!trainsRes.ok) {
                const errorData = await trainsRes.json();
                throw new Error(errorData.detail || `Server returned ${trainsRes.status}`);
            }
            
            if (updateRes.ok) {
                const updateData = await updateRes.json();
                if (updateData.last_update) {
                    lastUpdateTime = new Date(updateData.last_update);
                }
            } else {
                console.warn("Could not fetch last update time, using current time.");
                lastUpdateTime = new Date();
            }
            
            const trains = await trainsRes.json();
            currentTrainsData = trains;
            
            if (initialTrainParam && !selectedTrainId) {
                const train = currentTrainsData.find(t => t.train_number == initialTrainParam || t.vehicle_id == initialTrainParam);
                if (train) {
                    selectedTrainId = train.vehicle_id;
                }
            }
            
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
            
            setUpdatingStatus(false);
            errorState.classList.add('hidden');
        } catch (error) {
            showError(`Error fetching data: ${error.message}`);
            setUpdatingStatus(false, true);
        }
    }
    
    function getDelayColor(expected_time, aimed_time) {
        let delayMinutes = 0;
        let overdueMinutes = 0;
        if (expected_time && aimed_time) {
            const expected = new Date(expected_time);
            const aimed = new Date(aimed_time);
            delayMinutes = (expected - aimed) / 60000;
            
            const now = new Date();
            overdueMinutes = (now - expected) / 60000;
        }
        
        const effectiveDelay = Math.max(delayMinutes, overdueMinutes);
        
        if (effectiveDelay >= 35) return 'var(--accent-red)';
        if (effectiveDelay >= 15) return 'var(--accent-orange-red)';
        if (effectiveDelay >= 5) return 'var(--accent-orange)';
        return 'var(--accent-green)';
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
            
            let expectedTime = null;
            let aimedTime = null;
            
            if (train.monitored_call && train.monitored_call.expected_departure_time && train.monitored_call.aimed_departure_time) {
                expectedTime = train.monitored_call.expected_departure_time;
                aimedTime = train.monitored_call.aimed_departure_time;
            } else if (train.onward_calls && train.onward_calls.length > 0) {
                const call = train.onward_calls[0];
                if (call.expected_departure_time && call.aimed_departure_time) {
                    expectedTime = call.expected_departure_time;
                    aimedTime = call.aimed_departure_time;
                }
            }
            
            let borderColor = getDelayColor(expectedTime, aimedTime);
            
            const trainIcon = L.divIcon({
                className: 'custom-train-marker',
                html: `
                    <div class="train-icon-container" style="border-color: ${borderColor}; box-shadow: 0 4px 10px ${borderColor}60;">
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
                trainMarkers[train.vehicle_id].setZIndexOffset(1000);
            } else {
                // Create new marker
                const marker = L.marker([lat, lng], {
                    icon: trainIcon,
                    zIndexOffset: 1000
                }).addTo(map);
                
                marker.on('click', () => {
                    openTrain(train.vehicle_id);
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
        
        const timeString = lastUpdateTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        updateStatus.textContent = `Updated: ${timeString} (${serverTimezone}). Next in ${nextUpdateIn}s`;
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
                openTrain(train.vehicle_id);
                // Optionally scroll to top
                window.scrollTo({ top: 0, behavior: 'smooth' });
            };
            
            let expectedTime = null;
            let aimedTime = null;
            if (train.monitored_call && train.monitored_call.expected_departure_time && train.monitored_call.aimed_departure_time) {
                expectedTime = train.monitored_call.expected_departure_time;
                aimedTime = train.monitored_call.aimed_departure_time;
            } else if (train.onward_calls && train.onward_calls.length > 0) {
                const call = train.onward_calls[0];
                if (call.expected_departure_time && call.aimed_departure_time) {
                    expectedTime = call.expected_departure_time;
                    aimedTime = call.aimed_departure_time;
                }
            }
            const statusColor = getDelayColor(expectedTime, aimedTime);
            card.style.borderLeft = `4px solid ${statusColor}`;
            
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
                    <span class="badge" style="background-color: ${statusColor}20; color: ${statusColor}; border: 1px solid ${statusColor}40;">${direction}</span>
                </div>
                
                <div class="train-status">
                    <div class="station-label">Current Status</div>
                    <div class="status-message" style="color: ${statusColor};">${train.status_message}</div>
                </div>
            `;
            
            trainsContainer.appendChild(card);
        });
    }

    // Map Details Logic
    function updateURLParams() {
        const url = new URL(window.location);
        
        if (selectedStationId) {
            const callName = idToCallName[selectedStationId];
            url.searchParams.set('station', callName || selectedStationId);
        } else {
            url.searchParams.delete('station');
        }
        
        if (selectedTrainId) {
            const train = currentTrainsData.find(t => t.vehicle_id == selectedTrainId);
            if (train && train.train_number) {
                url.searchParams.set('train', train.train_number);
            } else {
                url.searchParams.set('train', selectedTrainId);
            }
        } else {
            url.searchParams.delete('train');
        }
        
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
            let call = calls.find(c => c.stop_point_ref === stop.id || c.stop_point_name === stop.name);
            let monitoredAtStop = false;
            if (!call && train.monitored_call && train.monitored_call.stop_point_ref === stop.id) {
                call = train.monitored_call;
                monitoredAtStop = train.monitored_call.at_stop === "true";
            }
            if (call) {
                passingTrains.push({
                    vehicleId: train.vehicle_id,
                    trainNumber: train.train_number,
                    direction: train.direction_ref === 'N' ? 'Northbound' : (train.direction_ref === 'S' ? 'Southbound' : train.direction_ref),
                    destination: train.destination_name,
                    expectedTime: call.expected_departure_time ? new Date(call.expected_departure_time) : null,
                    aimedTime: call.aimed_departure_time ? new Date(call.aimed_departure_time) : null,
                    expectedArr: call.expected_arrival_time && !monitoredAtStop? new Date(call.expected_arrival_time) : null,
                    aimedArr: call.aimed_arrival_time && !monitoredAtStop ? new Date(call.aimed_arrival_time) : null
                });
            }
        });

        passingTrains.sort((a, b) => {
            const timeA = a.expectedTime || a.expectedArr || new Date(0);
            const timeB = b.expectedTime || b.expectedArr || new Date(0);
            return timeA - timeB;
        });

        let rows = passingTrains.map((pt, index) => {
            const arrColor = getDelayColor(pt.expectedArr, pt.aimedArr);
            const depColor = getDelayColor(pt.expectedTime, pt.aimedTime);
            
            let inMinsText = '';
            // Determine which time to use for the countdown (prefer arrival if available, else departure)
            let sortTime = pt.expectedArr ? pt.expectedArr : pt.expectedTime;
            
            if (index < 2 && sortTime) {
                const now = new Date();
                const diffMs = sortTime - now;
                const diffMins = Math.max(0, Math.round(diffMs / 60000));
                inMinsText = ` <br/><span style="font-size: 0.85em; opacity: 0.8; font-weight: normal;">(in ${diffMins} min${diffMins !== 1 ? 's' : ''})</span>`;
            }
            
            const formatTime = (timeObj) => timeObj ? timeObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--:--';

            return `
            <tr>
                <td><a href="#" class="clickable-link" onclick="openTrain(${pt.vehicleId}); return false;"><strong>#${pt.trainNumber}</strong></a></td>
                <td>${pt.direction}</td>
                <td>${pt.destination}</td>
                <td>${formatTime(pt.aimedArr)}</td>
                <td style="color: ${pt.expectedArr ? arrColor : 'inherit'}; font-weight: bold;">
                    ${formatTime(pt.expectedArr)}${pt.expectedArr ? inMinsText : ''}
                </td>
                <td>${formatTime(pt.aimedTime)}</td>
                <td style="color: ${pt.expectedTime ? depColor : 'inherit'}; font-weight: bold;">
                    ${formatTime(pt.expectedTime)}${pt.expectedArr ? '' : inMinsText}
                </td>
            </tr>
            `;
        }).join('');
        
        if (passingTrains.length === 0) {
            rows = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">No upcoming trains found for this station.</td></tr>`;
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
                <table class="details-table" style="font-size: 0.9em;">
                    <thead>
                        <tr>
                            <th>Train #</th>
                            <th>Direction</th>
                            <th>Destination</th>
                            <th>Sch. Arr</th>
                            <th>Exp. Arr</th>
                            <th>Sch. Dep</th>
                            <th>Exp. Dep</th>
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
        
        const calls = [...(train.onward_calls || [])];
        calls.sort((a, b) => new Date(a.aimed_departure_time) - new Date(b.aimed_departure_time));
        
        let rows = calls.map(call => {
            const exp = new Date(call.expected_departure_time);
            const aimed = new Date(call.aimed_departure_time);
            const rowColor = getDelayColor(exp, aimed);
            const callName = idToCallName[call.stop_point_ref] || call.stop_point_ref;
            return `
            <tr>
                <td><a href="#" class="clickable-link" onclick="openStation('${call.stop_point_ref}'); return false;"><strong>${callName}</strong> - ${call.stop_point_name}</a></td>
                <td>${aimed.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                <td style="color: ${rowColor}; font-weight: bold;">${exp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
            </tr>
            `;
        }).join('');
        
        if (calls.length === 0) {
            rows = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary);">No upcoming stops available.</td></tr>`;
        }

        let currentStationHTML = '';
        if (train.monitored_call) {
            const call = train.monitored_call;
            const exp = new Date(call.expected_departure_time);
            const aimed = new Date(call.aimed_departure_time);
            const rowColor = getDelayColor(exp, aimed);
            const callName = idToCallName[call.stop_point_ref] || call.stop_point_ref;
            
            const isAtStop = call.at_stop;
            const sectionTitle = isAtStop ? 'Current Station' : 'Next Station';
            const scheduledLabel = isAtStop ? 'Scheduled Departure' : 'Scheduled Arrival';
            const expectedLabel = isAtStop ? 'Expected Departure' : 'Expected Arrival';
            
            const now = new Date();
            const overdueMins = Math.round((now - exp) / 60000);
            let overdueText = '';
            if (overdueMins > 0) {
                overdueText = ` <br/><span style="font-size: 0.85em; opacity: 0.8; font-weight: normal;">(${overdueMins} min${overdueMins !== 1 ? 's' : ''} overdue)</span>`;
            }
            
            currentStationHTML = `
            <div class="details-content" style="margin-bottom: 1rem;">
                <table class="details-table">
                    <thead>
                        <tr>
                            <th>${sectionTitle}</th>
                            <th>${scheduledLabel}</th>
                            <th>${expectedLabel}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><a href="#" class="clickable-link" onclick="openStation('${call.stop_point_ref}'); return false;"><strong>${callName}</strong> - ${call.stop_point_name}</a></td>
                            <td>${aimed.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                            <td style="color: ${rowColor}; font-weight: bold;">
                                ${exp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}${overdueText}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            `;
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
            ${currentStationHTML}
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

    window.openTrain = function(vehicleId) {
        selectedTrainId = vehicleId;
        const train = currentTrainsData.find(t => t.vehicle_id == vehicleId);
        if (train) {
            showTrainDetails(train);
            trainDetailsPane.classList.remove('order-second');
            trainDetailsPane.classList.add('order-first');
            stationDetailsPane.classList.remove('order-first');
            stationDetailsPane.classList.add('order-second');
        }
        updateURLParams();
        setTimeout(() => {
            trainDetailsPane.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
    };

    window.openStation = function(stationId) {
        selectedStationId = stationId;
        const stop = currentStopsData.find(s => s.id === stationId);
        if (stop) {
            showStationDetails(stop);
            stationDetailsPane.classList.remove('order-second');
            stationDetailsPane.classList.add('order-first');
            trainDetailsPane.classList.remove('order-first');
            trainDetailsPane.classList.add('order-second');
        }
        updateURLParams();
        setTimeout(() => {
            stationDetailsPane.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
    };

    // Start
    init();
});
