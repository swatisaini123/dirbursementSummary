var fs = require('fs');
var path = require('path');
var express = require('express');
var FormData = require('form-data');
var cors = require('cors');
var multer = require('multer');
var https = require('https');
var chalk = require('chalk');
const axios = require('axios');
const app = express();
const port = 3000;

// Enable CORS
app.use(cors());

// Multer setup for file upload
const upload = multer({ dest: 'uploads/' });

var options = {
  key: fs.readFileSync('./key.pem'),
  cert: fs.readFileSync('./cert.pem')
};

// Zoho API credentials
const clientId = "1000.ASUBTHHM42Y6IKGEM9QKX0Z3O9KP4O";
const clientSecret = "ac6b1ad4bef873dc09df47a9a03685a9ba470357d0";
const redirectUri = "https://crm.zoho.com/crm/org730932612";
const refreshToken = "1000.0d5832856292297a31191f6c9ee3d0e3.1ca05bcea6e676b7ddb0276cd762ae14";
const tokenFilePath = path.join(__dirname, 'token.json');

async function getAccessToken() {
  let tokenData = {};

  if (fs.existsSync(tokenFilePath)) {
    tokenData = await fs.promises.readFile(tokenFilePath, 'utf8').then(JSON.parse).catch(() => ({}));
  }

  const now = new Date();

  if (tokenData.accessToken && tokenData.expiry && new Date(tokenData.expiry) > now) {
    return tokenData.accessToken;
  }
  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);
  params.append('refresh_token', refreshToken);
  params.append('redirect_uri', redirectUri);

  try {
    const tokenResponse = await axios.post('https://accounts.zoho.com/oauth/v2/token', params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const accessToken = tokenResponse.data.access_token;
    //  console.log('accessToken::' + accessToken);
    const tokenExpiry = new Date(Date.now() + (3600 * 1000)); // Token valid for 1 hour

    tokenData = {
      accessToken,
      expiry: tokenExpiry
    };

    await fs.promises.writeFile(tokenFilePath, JSON.stringify(tokenData), 'utf8');

    return accessToken;
  } catch (error) {
    console.error('Token Fetch Error:', error.response ? error.response.data : error.message);
    throw new Error('Error fetching access token: ' + error.message);
  }
}

// Route to handle file upload and create a document request in Zoho Sign
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    console.log(req.body);
    //  console.log(req.body.documentName); 
    // console.log(typeof parseInt(req.body.numPages)); // The document name
    // The document name
    //   console.log(req.file); // The file information

    const accessToken = await getAccessToken();

    // Prepare the file for Zoho Sign
    const filePath = req.file.path;
    const form = new FormData();

    if (fs.existsSync(filePath)) {
      form.append('file', fs.createReadStream(filePath), {
        filename: 'Disbursement Summary - ' + req.body.documentName + '.pdf' || 'document.pdf',
        contentType: req.file.mimetype || 'application/pdf'
      });
    } else {
      throw new Error('File does not exist');
    }
    //console.log(req.body.documentName);
    // Add the document request details
    form.append('data', JSON.stringify({
      "requests": {
        "request_name": 'Disbursement Summary - ' + req.body.documentName,
        "description": "Details of document",
        "is_sequential": true,
        "actions": [
          {
            "action_type": "SIGN",
            "recipient_email": "esin@swigartlawgroup.com",
            "recipient_name": "Esin Aslan",
            "signing_order": 0,
            "verify_recipient": false,
            "verification_type": "EMAIL",
            "private_notes": "To be signed"
          }
        ],
        "expiration_days": 10,
        "email_reminders": true,
        "reminder_period": 2,
        "notes": "Please find attached a copy of your settlement disbursement form for your review and signature."
      }
    }));

    // Upload the file to Zoho Sign
    const response = await axios.post('https://sign.zoho.com/api/v1/requests', form, {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        ...form.getHeaders()
      }
    });

    const result = response.data;
    // Extract the document ID and request ID
    const documentId = result.requests.document_ids[0].document_id;
    const requestId = result.requests.request_id;
    const actionId = result.requests.actions[0].action_id;

    // Submit the document request
    const submitResponse = await fetch(`https://sign.zoho.com/api/v1/requests/${requestId}/submit`, {
      method: 'POST',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'data': JSON.stringify({
          "requests": {
            "request_name": 'Disbursement Summary - ' + req.body.documentName,
            "actions": [
              {
                "action_id": actionId,
                "recipient_name": req.body.ClientName,
                "recipient_email": req.body.ClientEmail,
                "action_type": "SIGN",
                "fields": {
                  "image_fields": [
                    {
                      "field_name": "Signature",
                      "field_label": "Signature",
                      "field_type_name": "Signature",
                      "document_id": documentId,
                      "action_id": actionId,
                      "is_mandatory": true,
                      "x_coord": 420,  
                      "y_coord": 725,   // Close to 0 for bottom placement
                      "abs_width": 150, 
                      "abs_height": 20, 
                      "page_no": parseInt(req.body.numPages) - 1,  // according to the Page as we need only the last Page for Signature
                      "is_resizable": true,
                      "is_draggable": true,
                      "description_tooltip": "Add your signature"  
                    }
                  ], "date_fields": [
                    {
                      "field_name": "Date",
                      "field_label": "Date",
                      "field_type_name": "CustomDate",
                      "document_id": documentId,
                      "action_id": actionId,
                      "is_mandatory": true,
                      "x_value": 10,
                      "y_value": 92,
                      "abs_width": 150,
                      "abs_height": 20,
                      "page_no": parseInt(req.body.numPages) - 1, 
                      "date_format": "MM/dd/yyyy",
                      "description_tooltip": "Add Date"
                    }
                  ]
                }
              }
            ]
          }
        })
      })
    });
    const responseData = await submitResponse.json();  
    console.log('Response Data:', responseData);  
    console.log('Response Data:', responseData);  
    
    if (submitResponse.ok) {
      res.status(200).json({ message: 'Document has been submitted and sent for signature' });
    } else {
      res.status(submitResponse.status).json({ error: responseData });
    }
  } catch (error) {
    console.error('Error:', error);
    // Ensure only one response is sent
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to send file' });
    }
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

https.createServer(options, app).listen(port, function () {
  console.log(chalk.green('Zet running at https://127.0.0.1:' + port));
  console.log(chalk.bold.cyan(`Note: Please enable the host (https://127.0.0.1:${port}) in a new tab and authorize the connection by clicking Advanced->Proceed to 127.0.0.1 (unsafe).`));
}).on('error', function (err) {
  if (err.code === 'EADDRINUSE') {
    console.log(chalk.bold.red(`${port} port is already in use`));
  }
});
