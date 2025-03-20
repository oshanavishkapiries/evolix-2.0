# Use Node.js LTS version
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose port from .env (5421)
EXPOSE 5421

# Set environment variables
ENV NODE_ENV=development
ENV PORT=5421

# Start the application
CMD ["npm", "start"] 