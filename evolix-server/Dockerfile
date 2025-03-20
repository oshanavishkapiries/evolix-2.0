# Base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json first (better caching)
COPY package*.json ./

# Install dependencies in production mode
RUN npm ci --only=production

# Copy rest of the application
COPY . .

# Expose port
EXPOSE 5421

# Start the application
CMD ["npm", "start"]
