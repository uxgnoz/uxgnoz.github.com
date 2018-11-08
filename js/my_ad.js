$(document).ready(function() {
    var bookIdPrefix = "book_";

    var randomBookId = 0;

    while (randomBookId === 0) {
        randomBookId = Math.round(Math.random() * 10);
    }

    if (randomBookId > 5) {
        randomBookId -= 5;
    }

    $("#" + bookIdPrefix + randomBookId).show();
});