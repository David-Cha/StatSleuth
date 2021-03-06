'use strict';

const { Client } = require('@elastic/elasticsearch');
const { PDFDocument } = require('pdf-lib');

const esclient = new Client({ node: 'http://localhost:9200' });
const index = 'pages';

const indexPdfPage = function (articleTitle, id, page, pageNumber) {
  console.log("indexPdfPage");

  esclient.index({
    index: articleTitle.toLowerCase(),
    id: id,
    body: {
      data: page,
      doc_name: articleTitle,
      doc_page: pageNumber
    },
    pipeline: 'attachment'
  });

  console.log("indexPdfPage done");
};

exports.indexPdfPages = async function (articleTitle, buffer) {
  const pdfDoc = await PDFDocument.load(buffer);
  const length = pdfDoc.getPages().length;

  for (let i=0; i < length; ++i) {
    const currentPageDoc = await PDFDocument.create();
    const [currentPage] = await currentPageDoc.copyPages(pdfDoc, [i]);
    currentPageDoc.addPage(currentPage);
    const currentPageDocBytes = await currentPageDoc.saveAsBase64();

    indexPdfPage(articleTitle, `${articleTitle}-${i+1}`, currentPageDocBytes, i+1);
  }

  await indexSentences(articleTitle, length);
};

const indexSentences = async function (articleTitle, totalPages) {
  console.log("indexSentences");

  for (let i=0; i < totalPages; ++i) {
    const { body } = await esclient.get({
      index: articleTitle.toLowerCase(),
      id: `${articleTitle}-${i+1}`
    });

    const text = body._source.attachment.content;
    const parsedSentences = parseSentencesInPage(text);

    for (const sentence of parsedSentences) {
      if (sentence != "") {
        await esclient.index({
          index: "sentences",
          body: {
            sentence: sentence,
            doc_name: articleTitle,
            doc_page: i+1
          }
        });
      }
    }
  }

  console.log("indexSentences done");
};

const parseSentencesInPage = function (text) {
    // parse text, break it into individual sentences
    // only get the sentences that contain statistics
    // store in array where each element contains the sentence

    var text=text.replace(' et al.', '<@#!'); 
    // set et al. to something else so it's not a sentence
    var text=text.replace(' etc.', '<@!!'); 
    // set etc. to something else so it's not a sentence
    var text=text.replace(' no.', '%^!*@&#$'); 
    var text=text.replace(' No.', '@^*#!@'); 
    // set no. to something else so it's not a sentence

    let sentences = text.split(/(\. |\.\n)/gm);

    var text=text.replace('<@#!', 'et al.'); // revert to et al.
    var text=text.replace('<@!!', 'etc.'); // revert to etc.
    var text=text.replace('%^!*@&#$', ' no.'); // revert to no.
    var text=text.replace( '@^*#!@', ' No.');  
    for (let i=0; i < sentences.length; i++){
      sentences[i]=sentences[i].trim();
        if (find_stat(sentences[i]) == 0){
            sentences[i] = null;
        }
        else{
            sentences[i]=sentences[i].replace(/\n/g, ' ');
        }

    }
    return sentences;
}

const find_stat = function (sentence) {
    var flag = 0;
    if (sentence.search("%") != -1) {
        // if line has %
        flag = 1;
    }
    else if (sentence.search(/\d*\.\d+/) > 0) {
        //if line has 111.111, .111 and is not at start of string
        flag = 2;
    }
    else if (sentence.search(/(=|<|>) ?((\d*\.\d*)|(\d+))/) != -1) {
        //if line has comparison test followed by space followed by numbers
        //if line has comparison test followed by numbers
        //include geq and leq here (=|<|>|GEQ|LEQ)
        flag = 3;
    }
    else if (sentence.search(/\d+ to \d+/) > 0){
        //if line has 111 to 111 and is not at start of string
        flag = 4;
    }
    else if (sentence.search(/\d+ ?- ?\d+/) > 0){
        //if line has 111-111 OR 111 - 111 and is not at start of string
        flag = 5;
    }
    return flag;
}

exports.deletePdfPages = async function (fileName) {
  esclient.deleteByQuery({
    index: index,
    body: {
      query: {
        term: {
          doc_name: fileName
        }
      }
    }
  });
};
