FROM node:22-alpine

WORKDIR /app

# Copy everything
COPY . .

# Install deps and build the frontend
WORKDIR /app/HerdHub
RUN npm install && npm run build

# Expose the port Railway will assign
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
