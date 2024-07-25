#!/bin/sh
DIR_PATH=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )

# Install node v18.12.1
curl -sL https://deb.nodesource.com/setup_18.x -o nodesource_setup.sh
sudo bash nodesource_setup.sh
sudo apt install nodejs -y
node -v

cd $DIR_PATH
sed -e "s/WORKING_DIR/$1/g" "$DIR_PATH/proxy-sample.service" > "$DIR_PATH/proxy.service"
cp -rf ./proxy.service /etc/systemd/system
systemctl start pureflex.service 
systemctl enable pureflex.service
ufw allow 443