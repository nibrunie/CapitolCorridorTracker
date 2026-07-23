# Use official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory to /app
WORKDIR /app

# Copy requirements and install them
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and static assets
COPY src/ ./src/
COPY data/ ./data/
COPY assets/ ./assets/
COPY favicon.ico ./favicon.ico

# Note: the static directory is not currently exposed in the container

# Cloud Run injects the PORT environment variable (default 8080)
ENV PORT=8080

# Make port available to the world outside this container
EXPOSE 8080

# Run uvicorn when the container launches
CMD ["uvicorn", "src.server:app", "--host", "0.0.0.0", "--port", "8080"]
