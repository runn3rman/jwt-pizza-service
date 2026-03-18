# Check if host is provided as a command line argument
if [ -z "$1" ]; then
  echo "Usage: $0 <host>"
  echo "Example: $0 http://localhost:3000"
  exit 1
fi
host=$1

response=$(curl -s -X PUT $host/api/auth -d '{"email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json')
token=$(echo $response | jq -r '.token')

# Add users
curl -X POST $host/api/auth -d '{"name":"pizza diner", "email":"d@jwt.com", "password":"diner"}' -H 'Content-Type: application/json'
curl -X POST $host/api/auth -d '{"name":"pizza franchisee", "email":"f@jwt.com", "password":"franchisee"}' -H 'Content-Type: application/json'
curl -s -X PUT $host/api/auth -d '{"email":"d@jwt.com", "password":"wrong-password"}' -H 'Content-Type: application/json' > /dev/null

# Add menu
curl -X PUT $host/api/order/menu -H 'Content-Type: application/json' -d '{ "title":"Veggie", "description": "A garden of delight", "image":"pizza1.png", "price": 0.0038 }'  -H "Authorization: Bearer $token"
curl -X PUT $host/api/order/menu -H 'Content-Type: application/json' -d '{ "title":"Pepperoni", "description": "Spicy treat", "image":"pizza2.png", "price": 0.0042 }'  -H "Authorization: Bearer $token"
curl -X PUT $host/api/order/menu -H 'Content-Type: application/json' -d '{ "title":"Margarita", "description": "Essential classic", "image":"pizza3.png", "price": 0.0042 }'  -H "Authorization: Bearer $token"
curl -X PUT $host/api/order/menu -H 'Content-Type: application/json' -d '{ "title":"Crusty", "description": "A dry mouthed favorite", "image":"pizza4.png", "price": 0.0028 }'  -H "Authorization: Bearer $token"
curl -X PUT $host/api/order/menu -H 'Content-Type: application/json' -d '{ "title":"Charred Leopard", "description": "For those with a darker side", "image":"pizza5.png", "price": 0.0099 }'  -H "Authorization: Bearer $token"

# Add franchise and store
curl -X POST $host/api/franchise -H 'Content-Type: application/json' -d '{"name": "pizzaPocket", "admins": [{"email": "f@jwt.com"}]}'  -H "Authorization: Bearer $token"
curl -X POST $host/api/franchise/1/store -H 'Content-Type: application/json' -d '{"franchiseId": 1, "name":"SLC"}'  -H "Authorization: Bearer $token"

diner_response=$(curl -s -X PUT $host/api/auth -d '{"email":"d@jwt.com", "password":"diner"}' -H 'Content-Type: application/json')
diner_token=$(echo $diner_response | jq -r '.token')

# Generate traffic that exercises request, auth, active-user, latency, and pizza metrics.
curl -s $host/ > /dev/null
curl -s $host/api/docs > /dev/null
curl -s $host/api/order/menu > /dev/null
curl -s $host/api/user/me -H "Authorization: Bearer $diner_token" > /dev/null
curl -s $host/api/order -H "Authorization: Bearer $diner_token" > /dev/null

# Successful pizza purchase.
curl -s -X POST $host/api/order \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $diner_token" \
  -d '{"franchiseId":1,"storeId":1,"items":[{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":2,"description":"Pepperoni","price":0.0042}]}' > /dev/null

# Oversized order to encourage slow/failing pizza creation at the factory.
curl -s -X POST $host/api/order \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $diner_token" \
  -d '{"franchiseId":1,"storeId":1,"items":[
    {"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},
    {"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},
    {"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},
    {"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},{"menuId":1,"description":"Veggie","price":0.0038},
    {"menuId":1,"description":"Veggie","price":0.0038}
  ]}' > /dev/null

echo "Database data and metrics traffic generated"
