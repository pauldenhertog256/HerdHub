FROM node:22-alpine

# Build tools required by better-sqlite3 (native C++ addon)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy everything
COPY . .

# Install deps (compiles better-sqlite3 native addon) and build the frontend
WORKDIR /app/HerdHub
RUN npm install && npm run build

# Expose the port Railway will assign
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
