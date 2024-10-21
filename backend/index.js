require("./db");
const express = require('express');
const parser = require('body-parser');
const cors = require('cors');
const { signin, form, head_cat, sub_cat, month, department, vehicle, employee, fy_year} = require('./schema');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');

const app = express();

const monthOrder = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

app.use(cors());
app.use(parser.urlencoded({ extended: true }));
app.use(parser.json());
app.use(express.static('public'));


// Signin process
app.post('/signin', async (req, res) => {
    try {
        const user = req.body.username;
        const pass = req.body.password;
        const preuser = await signin.findOne({ 
            '$and': [
                { "username": { '$eq': user } }, 
                { "password": { '$eq': pass } }
            ] 
        });

        if (preuser) {
            const cred = {
                "username": user,
                "password": pass,
                "admin": preuser.admin  // Include admin status in the response
            };
            res.json(cred);
        } else {
            res.json({ "message": "error" });
        }
    } catch (err) {
        res.status(500).json({ "error": err });
    }
});


// Post form with file upload and PDF merging
// Ensure directories exist
const ensureDir = (dir) => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
};

// Ensure the upload and merged PDFs directories exist
ensureDir(path.join(__dirname, 'public', 'pdf'));
ensureDir(path.join(__dirname, 'public', 'merged_pdfs'));

// Multer storage configuration

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, 'public', 'pdf')); // Save to the 'public/pdf' directory
    },
    filename: (req, file, cb) => {
        const safeFilename = file.originalname.trim(); // Ensure no leading/trailing spaces
        // console.log('Saving file with original name:', safeFilename);
        cb(null, safeFilename); // Save with the original name
    }
});

const upload = multer({ storage: storage });




// Function to merge PDF files
// Utility function to add an image as a page in the PDF


// Utility function to add an image as a page in the PDF
const addImageToPdf = async (pdfDoc, imageBuffer, extension) => {
    try {
        let image;
        switch (extension) {
            case '.png':
                image = await pdfDoc.embedPng(imageBuffer);
                break;
            case '.jpg':
            case '.jpeg':
                image = await pdfDoc.embedJpg(imageBuffer);
                break;
            default:
                throw new Error(`Unsupported image type: ${extension}`);
        }

        const { width, height } = image.scale(1);
        const page = pdfDoc.addPage([width, height]);
        page.drawImage(image, {
            x: 0,
            y: 0,
            width,
            height,
        });
    } catch (error) {
        console.error('Error adding image to PDF:', error);
        throw error;
    }
};

// Updated function to merge files
const mergeFilesToPdf = async (files, outputPath) => {
    try {
        const pdfDoc = await PDFDocument.create();

        for (const file of files) {
            const filePath = path.join(__dirname, 'public', 'pdf', file.filename);
            // console.log(`Processing file: ${filePath}`);
            if (!fs.existsSync(filePath)) {
                console.error(`File not found: ${filePath}`);
                throw new Error(`File not found: ${filePath}`);
            }

            const fileBuffer = fs.readFileSync(filePath);
            const ext = path.extname(file.filename).toLowerCase();

            if (ext === '.pdf') {
                const pdf = await PDFDocument.load(fileBuffer);
                const copiedPages = await pdfDoc.copyPages(pdf, pdf.getPageIndices());
                copiedPages.forEach((page) => pdfDoc.addPage(page));
            } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
                await addImageToPdf(pdfDoc, fileBuffer, ext);
            } else {
                console.error(`Unsupported file type: ${ext}`);
                throw new Error(`Unsupported file type: ${ext}`);
            }
        }

        const pdfBytes = await pdfDoc.save();
        fs.writeFileSync(outputPath, pdfBytes);
        // console.log(`PDF saved to: ${outputPath}`);
    } catch (error) {
        console.error('Error merging files:', error);
        throw error;
    }
};



// Post form with file upload and PDF merging

app.post('/postform', upload.array('files'), async (req, res) => {
    try {
        // console.log('Files received:', req.files);

        // Extract and parse form fields from req.body
        const { fy_year, month, head_cat, sub_cat, date, received_by, particulars, bill_no, departments, amount, vehicles } = req.body;

        // Convert JSON strings back to objects
        const parsedFy_year = JSON.parse(fy_year || '[]');
        const parsedMonth = JSON.parse(month || '[]');
        const parsedHeadCat = JSON.parse(head_cat || '[]');
        const parsedSubCat = JSON.parse(sub_cat || '[]');
        const parsedReceivedBy = JSON.parse(received_by || '[]');
        const parsedDepartments = JSON.parse(departments || '[]');
        const parsedVehicles = JSON.parse(vehicles || '[]');

        // Generate output file name for the merged PDF
        const billNumber = bill_no || 'unknown';
        const todayDate = date || new Date().toISOString().split('T')[0];
        const randomNumber = Math.floor(Math.random() * 1000);
        const outputFileName = `${billNumber}_${todayDate}_${randomNumber}.pdf`;
        const outputPath = path.join(__dirname, 'public', 'merged_pdfs', outputFileName);

        // Process files (e.g., merge PDFs)
        await mergeFilesToPdf(req.files, outputPath);

        // Collect original filenames to store in the 'uploads' array
        const uploadedFiles = req.files.map(file => file.originalname);

        // Save form data along with the output file name and uploaded file name
        const newForm = new form({
            fy_year : parsedFy_year,
            month : parsedMonth,
            head_cat: parsedHeadCat,
            sub_cat: parsedSubCat,
            date,
            received_by: parsedReceivedBy,
            particulars,
            bill_no,
            departments: parsedDepartments,
            amount,
            vehicles: parsedVehicles,
            files: outputFileName, // Merged PDF filename
            uploads: uploadedFiles  // Original filenames
        });

        await newForm.save();
        res.json({ message: `${fy_year} has been added` });
        // console.log(newForm);
    } catch (error) {
        console.error('Error saving form:', error);
        res.status(500).json({ error: 'Failed to add form' });
    }
});

// Get forms
app.get('/getforms', async (req, res) => {
    try {
        const data = await form.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

// GET FORM DATA BY FY YEAR AND MONTH 

app.get('/fy_year_month/:fy_year/:month', async (req, res) => {
    const { fy_year, month } = req.params;
    try {
        // Find the forms where fy_name and month_name match the request params
        const found = await form.find({
            'fy_year.fy_name': Number(fy_year),
            'month.month_name': month
        });

        // Return the found forms
        res.json(found);
    } catch (error) {
        // Handle errors and respond with an error message
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});


// FORM FY YEAR DROP DOWN 

app.get('/getfyyearoption', async (req, res) => {
    try {
        // Fetch only the fy_year field from the documents
        const data = await form.find({}, { fy_year: 1, _id: 0 }).exec();

        // Extract fy_year values and remove duplicates
        const fyYears = data.map(doc => doc.fy_year);
        const uniqueFyYears = [...new Set(fyYears)];

        // Map unique fy_year values to the desired format
        const formattedData = uniqueFyYears.map(year => ({ fy_year: year }));

        // Return the formatted data as a JSON array
        res.json(formattedData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve fy_year' });
    }
});

// FORM MONTH DROP DOWN 

app.get('/getmonthoption', async (req, res) => {
    try {
        // Define the order of months

        // Fetch only the month field from the documents
        const data = await form.find({}, { month: 1, _id: 0 }).exec();

        // Extract month values and remove duplicates
        const months = data.map(doc => doc.month);
        const uniqueMonths = [...new Set(months)];

        // Sort unique months based on the predefined order
        const sortedMonths = uniqueMonths.sort((a, b) => {
            return monthOrder.indexOf(a) - monthOrder.indexOf(b);
        });

        // Map sorted months to the desired format
        const formattedData = sortedMonths.map(month => ({ month }));

        // Return the formatted data as a JSON array
        res.json(formattedData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve months' });
    }
});








// Get form by various filters
app.get('/amount/:given', async (req, res) => {
    try {
        const found = await form.find({ "amount": { '$eq': req.params.given } });
        res.json(found);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

app.get('/particulars/:given', async (req, res) => {
    try {
        const found = await form.find({ "particulars": { '$eq': req.params.given } });
        res.json(found);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

// Get form by various filters FOR FY YEAR 
app.get('/fy_year/:given', async (req, res) => {
    try {
        const found = await form.find({ "fy_year.fy_name": { '$eq': Number(req.params.given) } });
        res.json(found);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

app.get('/month/:given', async (req, res) => {
    try {
        const found = await form.find({ "month.month_name": { '$eq': req.params.given } });
        res.json(found);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

app.get('/date/:given', async (req, res) => {
    try {
        const found = await form.find({ "date": { '$eq': req.params.given } });
        res.json(found);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

app.get('/getFormByHeadCatName/:head_cat_name', async (req, res) => {
    try {
        const forms = await form.find({
            'head_cat.head_cat_name': req.params.head_cat_name,
        });
        res.json(forms);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

app.get('/getFormBySubCatName/:sub_cat_name', async (req, res) => {
    try {
        const forms = await form.find({
            'sub_cat.sub_cat_name': req.params.sub_cat_name,
        });
        res.json(forms);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

app.get('/getFormByVehicleID/:vehicle_id', async (req, res) => {
    try {
        const vehicleId = Number(req.params.vehicle_id);
        const forms = await form.find({
            'vehicles.vehicle_id': vehicleId,
        });
        res.json(forms);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

app.get('/getFormByEmployeeID/:emp_id', async (req, res) => {
    try {
        const empID = Number(req.params.emp_id);
        const forms = await form.find({
            'received_by.emp_id': empID,
        });
        res.json(forms);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve forms' });
    }
});

// Get head category
app.get('/gethead_cat', async (req, res) => {
    try {
        const data = await head_cat.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve head_cat' });
    }
});

// Get sub category
app.get('/getsub_cat', async (req, res) => {
    try {
        const data = await sub_cat.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve sub_cat' });
    }
});

// Get month


app.get('/getmonth', async (req, res) => {
    try {
        // Retrieve all months from the database
        const data = await month.find();
        
        // Sort the data based on the custom month order
        const sortedData = data.sort((a, b) => {
            return monthOrder.indexOf(a.month_name) - monthOrder.indexOf(b.month_name);
        });

        res.json(sortedData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve month' });
    }
});


// Get department
app.get('/getdepartment', async (req, res) => {
    try {
        const data = await department.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve department' });
    }
});

// Get employee
app.get('/getemployee', async (req, res) => {
    try {
        const data = await employee.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve employee' });
    }
});

// Get vehicle
app.get('/getvehicle', async (req, res) => {
    try {
        const data = await vehicle.find();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve vehicle' });
    }
});

// Get financial year
app.get('/getfy_year', async (req, res) => {
    try {
        const fy_year_data = await fy_year.find();
        res.json(fy_year_data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve fy_year' });
    }
});


// TRUE FY YEAR ADMIN 

app.post('/settruefyyear', async (req, res) => {
    let { fy_name } = req.body;
  
  
    // Validate the input
    if (typeof fy_name !== 'number') {
      return res.status(400).send('Invalid input: fy_name must be a number');
    }
  
    try {
      // Find or create fiscal year
      const fyYear = await fy_year.findOneAndUpdate(
        { fy_name },
        { fy_id: true },
        { new: true, upsert: true } // upsert creates a new document if none is found
      );
  
      res.json(fyYear);
    } catch (err) {
      console.error('Error processing request:', err);
      res.status(500).send('Error processing request');
    }
  });

  // FALSE FY YEAR ADMIN
  app.post('/setfalsefyyear', async (req, res) => {
    let { fy_name } = req.body;

    // Validate the input
    if (typeof fy_name !== 'number') {
        return res.status(400).send('Invalid input: fy_name must be a number');
    }

    try {
        // Find or create fiscal year and set fy_id to false
        const fyYear = await fy_year.findOneAndUpdate(
            { fy_name },
            { fy_id: false }, // Set fy_id to false
            { new: true, upsert: true } // upsert creates a new document if none is found
        );

        res.json(fyYear);
    } catch (err) {
        console.error('Error processing request:', err);
        res.status(500).send('Error processing request');
    }
});

 // TRUE MONTH ADMIN
app.post('/setmonthtrue', async (req, res) => {
    const { month_name } = req.body;
 

    // Validate the input
    if (typeof month_name !== 'string') {
        return res.status(400).send('Invalid input: month_name must be a string');
    }

    try {
        // Find or create month and set month_id to true
        const monthDoc = await month.findOneAndUpdate(
            { month_name },
            { month_id: true }, // Set month_id to true
            { new: true, upsert: true } // upsert creates a new document if none is found
        );

        res.json(monthDoc);
    } catch (err) {
        console.error('Error processing request:', err);
        res.status(500).send('Error processing request');
    }
});

// FALSE MONTH ADMIN
app.post('/setmonthfalse', async (req, res) => {
    const { month_name } = req.body;

    // Validate the input
    if (typeof month_name !== 'string') {
        return res.status(400).send('Invalid input: month_name must be a string');
    }

    try {
        // Find or create month and set month_id to false
        const monthDoc = await month.findOneAndUpdate(
            { month_name },
            { month_id: false }, // Set month_id to false
            { new: true, upsert: true } // upsert creates a new document if none is found
        );

        res.json(monthDoc);
    } catch (err) {
        console.error('Error processing request:', err);
        res.status(500).send('Error processing request');
    }
});

// DELETE FORM 

const mergedPdfPath = path.join(__dirname, 'public/merged_pdfs');
const uploadsPath = path.join(__dirname, 'public/pdf');

// Delete endpoint
app.delete('/erase/:id', async (request, response) => {
    try {
        // Find the document by ID and delete it
        const data = await form.findByIdAndDelete(request.params.id);

        if (!data) {
            return response.status(404).json({ message: 'Data not found' });
        }

        // Extract file names from the document
        const { files, uploads } = data; // Assuming 'files' is for merged PDFs and 'uploads' for other files

        // Delete the merged PDF file if it exists
        if (files) {
            const mergedPdfFile = path.join(mergedPdfPath, files);
            if (fs.existsSync(mergedPdfFile)) {
                fs.unlinkSync(mergedPdfFile);
                console.log(`Deleted merged PDF: ${mergedPdfFile}`);
            }
        }

        // Delete each upload file if they exist
        if (uploads && uploads.length > 0) {
            uploads.forEach(file => {
                const uploadFile = path.join(uploadsPath, file);
                if (fs.existsSync(uploadFile)) {
                    fs.unlinkSync(uploadFile);
                    console.log(`Deleted upload file: ${uploadFile}`);
                }
            });
        }

        // Respond with success message
        response.json({ message: 'Data and associated files deleted successfully', data });
    } catch (error) {
        console.error('Error deleting data and files:', error);
        response.status(500).json({ message: 'Internal server error', error });
    }
});


// MODIFY FORM
app.put('/modify', upload.array('files'), async (req, res) => {
    try {
        // Extract form fields from req.body
        const { _id, fy_year, month, head_cat, sub_cat, date, received_by, particulars, bill_no, departments, amount, vehicles } = req.body;

        // Function to safely parse JSON fields
        const safeJsonParse = (data) => {
            try {
                return JSON.parse(data);
            } catch (error) {
                return []; // Return an empty array or handle as appropriate
            }
        };

        // Parse JSON strings
        const parsedFy_year = safeJsonParse(fy_year || '[]');
        const parsedMonth = safeJsonParse(month || '[]');
        const parsedHeadCat = safeJsonParse(head_cat || '[]');
        const parsedSubCat = safeJsonParse(sub_cat || '[]');
        const parsedReceivedBy = safeJsonParse(received_by || '[]');
        const parsedDepartments = safeJsonParse(departments || '[]');
        const parsedVehicles = safeJsonParse(vehicles || '[]');

        // Check if the request body contains an ID
        if (!_id) {
            return res.status(400).json({ message: 'ID is required for updating the form.' });
        }

        // Process files (e.g., merge PDFs)
        let outputFileName = null;
        if (req.files && req.files.length > 0) {
            const billNumber = bill_no || 'unknown';
            const todayDate = date || new Date().toISOString().split('T')[0];
            const randomNumber = Math.floor(Math.random() * 1000);
            outputFileName = `${billNumber}_${todayDate}_${randomNumber}.pdf`;
            const outputPath = path.join(__dirname, 'public', 'merged_pdfs', outputFileName);

            await mergeFilesToPdf(req.files, outputPath);
        }

        // Find and update the form by ID
        const updatedForm = await form.findByIdAndUpdate(
            _id,
            {
                fy_year: parsedFy_year,
                month: parsedMonth,
                head_cat: parsedHeadCat,
                sub_cat: parsedSubCat,
                date,
                received_by: parsedReceivedBy,
                particulars,
                bill_no,
                departments: parsedDepartments,
                amount,
                vehicles: parsedVehicles,
                files: outputFileName ? outputFileName : undefined, // Update the files field only if there is a new file
                uploads: req.files ? req.files.map(file => file.originalname) : undefined // Update uploads field if files are uploaded
            },
            { new: true, runValidators: true } // Return the updated document and run schema validators
        );

        // Check if the form was found and updated
        if (!updatedForm) {
            return res.status(404).json({ message: 'Form not found.' });
        }

        // Return the updated form data
        res.status(200).json(updatedForm);

    } catch (error) {
        console.error('Error updating form:', error);
        res.status(500).json({ message: 'Server error', error });
    }
});

  


// GET FORM BY ID 
app.get('/getforms/:id', async (req, res) => {
    try {
      const formId = req.params.id; 
      const formdata = await form.findById(formId);
      if (!formdata) {
        return res.status(404).json({ message: 'Form not found' });
      }
      res.status(200).json(formdata);
    } catch (error) {
      console.error('Error fetching form data:', error);
      res.status(500).json({ message: 'Server error', error });
    }
  });

app.listen(1111, () => {
    console.log("Express connected!!!");
});