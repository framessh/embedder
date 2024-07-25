#!/bin/sh
DIR_PATH=$( cd "$(dirname "${BASH_SOURCE[0]}")" ; pwd -P )

cd $DIR_PATH
sed -e "s/WORKING_DIR/$1/g" "$DIR_PATH/proxy-sample.service" > "$DIR_PATH/proxy.service"
cp -rf ./proxy.service /etc/systemd/system
systemctl start pureflex.service 
systemctl enable pureflex.service
ufw allow 443