# base image
FROM node:20-alpine

# set working 
WORKDIR /app

# copy package.json and package-lock.json
COPY package*.json ./

# install dependencies
RUN npm install

# copy source cod
COPY . .

# expose port
EXPOSE 5421

# start app
CMD ["npm","start"]