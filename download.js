const AnyList = require('anylist');
const fs = require('fs');  // Regular fs for createWriteStream
const fsPromises = require('fs/promises');  // Promised version for mkdir
const PDFDocument = require('pdfkit');
const path = require('path');
const https = require('https');

// Helper function to sanitize filenames
function sanitizeFilename(name) {
    return name.replace(/[/\\?%*:|"<>]/g, '-').trim();
}

// Helper function to format dates
function formatDate(timestamp) {
    const date = new Date(timestamp * 1000); // Convert Unix timestamp to JS Date
    return {
        fileName: date.getFullYear() < 2000 ? 
            '' : // No date for pre-2000
            date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).replace(/\//g, '-'), // Convert slashes to hyphens for filename
        display: date.getFullYear() < 2000 ? 
            'Unknown' : // Removed underscores
            date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            })
    };
}

// Add this helper function to download images
function downloadImage(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download image: ${response.statusCode}`));
                return;
            }
            
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

async function downloadRecipes() {
    // Initialize AnyList client with credentials options
    const anylist = new AnyList({
        email: process.env.ANYLIST_EMAIL,
        password: process.env.ANYLIST_PASSWORD,
        // By default, credentials will be stored in ~/.anylist_credentials
        // You can specify a different path if desired:
        // credentialsFile: '/path/to/your/.anylist_credentials'
    });
    
    const generatePDF = true;
    // Set maximum number of PDFs to generate (use -1 for all recipes)
    const maxPDFsToGenerate = 1000;
    
    // Just call login() - it will handle credential storage automatically
    await anylist.login();
    
    // Get all recipes
    const recipes = await anylist.getRecipes();

    // Save all recipes to a JSON file
    const recipesJson = JSON.stringify(recipes, null, 2);
    await fsPromises.writeFile('recipe-pdfs/all-recipes.json', recipesJson);
    console.log('Saved all recipes to all-recipes.json');

    if (generatePDF) {
        // Create a directory for PDFs if it doesn't exist
        await fsPromises.mkdir('recipe-pdfs', { recursive: true });
        
        // Process recipes with limit
        const recipesToProcess = maxPDFsToGenerate === -1 ? recipes : recipes.slice(0, maxPDFsToGenerate);
        for (const recipe of recipesToProcess) {
            try {
                // if ((recipe.identifier == "0ea2deb820de428a82176c6acd2575b5") || (recipe.name == "Ziti Chickpeas with Sausage and Kale")) {
                
                //     // Print recipe JSON to console
                //     console.log('Recipe JSON:');
                //     console.log(JSON.stringify(recipe, null, 2));

                await new Promise(async (resolve, reject) => {
                    const doc = new PDFDocument({
                        size: 'LETTER',
                        margins: {
                            top: 72,
                            bottom: 72,
                            left: 72,
                            right: 72
                        }
                    });
                    const dateStr = formatDate(recipe.creationTimestamp);
                    const filename = (dateStr.fileName ? `${dateStr.fileName} - ` : '') + 
                        sanitizeFilename(recipe.name);  // Date first, then recipe name
                    const outputPath = path.join('recipe-pdfs', `${filename}.pdf`);
                    const stream = fs.createWriteStream(outputPath);
                    
                    // Handle stream errors
                    stream.on('error', reject);
                    
                    // When the PDF is finished being written
                    stream.on('finish', resolve);
                    
                    doc.pipe(stream);
                    
                    // Title and metadata
                    doc.fontSize(24).font('Helvetica-Bold').text(recipe.name, { align: 'center' });
                    doc.moveDown();

                    // Add photo if available
                    if (recipe.photoIds && recipe.photoIds.length > 0) {
                        try {
                            const photoUrl = `https://photos.anylist.com/${recipe.photoIds[0]}.jpg`;
                            const imageBuffer = await downloadImage(photoUrl);
                            
                            // Define image dimensions and position
                            const maxWidth = 200;
                            const maxHeight = 200;
                            
                            // Get image dimensions to maintain aspect ratio
                            const image = doc.openImage(imageBuffer);
                            const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
                            const width = image.width * ratio;
                            const height = image.height * ratio;
                            
                            // Position image in right side after title
                            const x = doc.page.width - doc.page.margins.right - width;
                            const y = doc.y; // Current y position after title
                            
                            doc.image(imageBuffer, x, y, {
                                width: width,
                                height: height
                            });
                            
                            // Ensure text content starts at the top of the image
                            doc.y = y;
                        } catch (error) {
                            console.error(`Failed to add photo for ${recipe.name}:`, error);
                        }
                    }

                    // Add creation date
                    doc.fontSize(12).font('Helvetica-Bold').text('Created:', { continued: true })
                        .font(new Date(recipe.creationTimestamp * 1000).getFullYear() < 2000 ? 'Helvetica-Oblique' : 'Helvetica')
                        .text(` ${dateStr.display}`, { align: 'left' });
                    doc.moveDown();

                    // Add source information if available
                    if (recipe.sourceName || recipe.sourceUrl) {
                        doc.fontSize(12).font('Helvetica-Bold').text('Source:', { align: 'left' });
                        doc.font('Helvetica');  // Reset to regular font
                        if (recipe.sourceName && recipe.sourceUrl) {
                            // Use sourceName as clickable text for the URL
                            doc.fontSize(12).text(recipe.sourceName, { 
                                align: 'left', 
                                link: recipe.sourceUrl,
                                underline: true,
                                color: 'blue',
                                width: doc.page.width,
                                lineBreak: false
                            });
                        } else {
                            // Show them separately if only one exists
                            if (recipe.sourceName) {
                                doc.fontSize(12).text(recipe.sourceName, { align: 'left' });
                            }
                            if (recipe.sourceUrl) {
                                doc.moveDown();
                                doc.fontSize(12).font('Helvetica-Bold').text('Source URL:', { align: 'left' });
                                doc.fontSize(12).text(recipe.sourceUrl, { 
                                    align: 'left', 
                                    link: recipe.sourceUrl,
                                    underline: true,
                                    color: 'blue',
                                    width: doc.page.width,
                                    lineBreak: false
                                });
                            }
                        }
                        doc.moveDown();
                    }

                    // Add serving size if available
                    if (recipe.servings) {
                        doc.fontSize(12).font('Helvetica-Bold').text('Servings:', { continued: true })
                            .font('Helvetica').text(` ${recipe.servings}`);
                        doc.moveDown();
                    }

                    // Add rating if available
                    if (recipe.rating) {
                        doc.fontSize(12).font('Helvetica-Bold').text('Rating:', { continued: true })
                            .font('Helvetica').text(` ${recipe.rating} stars`);
                        doc.moveDown();
                    }
                    else {
                        doc.fontSize(12).font('Helvetica-Bold').text('Rating:', { continued: true })
                            .font('Helvetica').text(' No rating available');
                        doc.moveDown();
                    }

                    // Add preparation and cooking time if available
                    if (recipe.prepTime || recipe.cookTime) {
                        const times = [];
                        if (recipe.prepTime) times.push(`Prep Time: ${recipe.prepTime/60} min`);
                        if (recipe.cookTime) times.push(`Cook Time: ${recipe.cookTime/60} min`);
                        doc.fontSize(12).text(times.join(' | '));
                        doc.moveDown();
                    }

                    // Add categories/tags if available
                    if (recipe.categories && recipe.categories.length > 0) {
                        doc.fontSize(12).text(`Categories: ${recipe.categories.join(', ')}`);
                        doc.moveDown();
                    }

                    // Add notes if available
                    if (recipe.notes) {
                        doc.fontSize(14).text('Notes:');
                        doc.fontSize(12).text(recipe.notes);
                        doc.moveDown();
                    }
                    
                    
                    
                    // Add ingredients section
                    doc.moveDown(0.5);
                    doc.fontSize(16).font('Helvetica-Bold').text('Ingredients:');
                    doc.moveDown(0.5);
                    doc.font('Helvetica');  // Reset to regular font
                    recipe.ingredients.forEach(ingredient => {
                        // Log each ingredient to see its structure
                        
                        doc.fontSize(12).text(`${ingredient.rawIngredient}`);
                    });
                    
                    // Add instructions if available
                    if (recipe.instructions) {
                        doc.moveDown();
                        doc.fontSize(16).font('Helvetica-Bold').text('Instructions:');
                        doc.moveDown(0.5);
                        doc.font('Helvetica');  // Reset to regular font
                        
                        const steps = recipe.instructions.split('\n').filter(step => step.trim());
                        steps.forEach((step, index) => {
                            doc.fontSize(12).text(`${index + 1}. ${step.trim()}`);
                            doc.moveDown(0.5);
                        });
                    }

                    // Add preparation steps if available
                    if (recipe.preparationSteps && recipe.preparationSteps.length > 0) {
                        doc.moveDown();
                        doc.fontSize(16).font('Helvetica-Bold').text('Preparation Steps:');
                        doc.moveDown(0.5);
                        
                        let stepNumber = 1;
                        recipe.preparationSteps.forEach(step => {
                            const trimmedStep = step.trim();
                            if (trimmedStep.startsWith('#')) {
                                // Special step - make it bold without number
                                doc.fontSize(12)
                                    .font('Helvetica-Bold').text(trimmedStep.substring(1).trim());
                            } else {
                                // Normal step - numbered with bold number
                                doc.fontSize(12)
                                    .font('Helvetica-Bold').text(`${stepNumber}.`, { continued: true })
                                    .font('Helvetica').text(` ${trimmedStep}`);
                                stepNumber++;
                            }
                            doc.moveDown(0.5);
                        });
                    }

                    // Add recipe note if available
                    if (recipe.note || recipe.notes) {
                        doc.moveDown();
                        doc.fontSize(16).font('Helvetica-Bold').text('Notes:');
                        doc.moveDown(0.5);
                        doc.fontSize(12).font('Helvetica').text(recipe.note || recipe.notes);
                        doc.moveDown();
                    }

                    // Add nutritional information if available
                    if (recipe.nutritionalInfo) {
                        doc.moveDown();
                        doc.fontSize(16).font('Helvetica-Bold').text('Nutritional Information:');
                        doc.moveDown(0.5);
                        doc.font('Helvetica');  // Reset to regular font
                        
                        const nutritionLines = recipe.nutritionalInfo.split('\n');
                        nutritionLines.forEach(line => {
                            doc.fontSize(12).text(line);
                        });
                        doc.moveDown();
                    }
                    
                    doc.end();
                    console.log(`Created PDF for: ${recipe.name}`);
                });
                // } 
                
            } catch (error) {
                console.error(`Failed to create PDF for ${recipe.name}:`, error);
            }
        }
    }
    
    console.log(`Finished processing ${recipes.length} recipes`);
    // Cleanup and exit
    await anylist.teardown();
    process.exit(0);
}

downloadRecipes().catch(console.error); 