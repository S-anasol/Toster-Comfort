
function getURL(url,callback, on_fail) {
	//console.log('URL:',url);
	let xhr = new XMLHttpRequest();
	xhr.timeout = 13000;
	xhr.onreadystatechange = function() {
		if (this.readyState == 4) {
			//console.log('success');
			if (this.status != 200) {
				console.log("error", this.status);
				if (on_fail) on_fail();
				return;
			}
			//window[back] = xhr.responseText;
			if(callback)callback(xhr.responseText);
		}
	};
	//xhr.ontimeout = function() {
		//console.log('timeout');
	//}
	xhr.open("GET", url, true);
	xhr.send();
}

const db_clean_steps = [7, 3, 2, 1, 0.5, 0.2];

function clean_db(timeout_days) {
	const timeout = timeout_days *24*60*60*1000;
	//remove pending status
	for(let id in db.user) {
		if (!db.user[id]) {
			delete db.user[id];
			continue;
		}
		delete db.user[id].solutions_pending;
		delete db.user[id].karma_pending;
	}
	//remove users
	let now = (new Date()).getTime();
	for(let id in db.user) {
		let user = db.user[id];
		if (!(now - user.update_time < timeout)) delete db.user[id]; // n days
	}
	//remove questions
	for(let id in db.question) {
		let q = db.question[id];
		//ignore subscribtions
		if (q.sub) {
			if (!(now - q.ut < 400 * 24 * 60 * 60000)) delete db.question[id]; // 1 year
			continue;
		}
		//ut means update_time
		if (!(now - q.ut < timeout)) delete db.question[id]; // n days
	}
}


const MAX_DB_TIMEOUT = 60000;
let saveDB_timer;
let db_saved_called;
function saveDB(no_pause) {
	let now = (new Date()).getTime();
	db_saved_called = db_saved_called || now;
	if (saveDB_timer !== undefined) clearTimeout(saveDB_timer);
	function saveDB_Now() {
		for(let i=0;i<db_clean_steps.length;i++) {
			clean_db(db_clean_steps[i]);
			try {
				localStorage.db = JSON.stringify(db);
				break;
			} catch(e) {
				console.log("Can't save DB");
			}
		}
		db_saved_called = undefined;
		//console.log('DB_SAVED!');
	}
	if ((now - db_saved_called > MAX_DB_TIMEOUT)||no_pause) saveDB_Now();
	else saveDB_timer = setTimeout(saveDB_Now,15000);
}

if (localStorage.cut_karma === undefined) localStorage.cut_karma = 1;
//
function updateUser(nickname,timeout) {
	//console.log('update:',nickname);
	if (!nickname) return console.log('No nickname!'); //impossible
	let user = db.user[nickname];
	if (!user) user = db.user[nickname] = {}; //impossible
	user.nickname = nickname;
	let now = (new Date()).getTime();
	let need_update = false;
	if (!(now - user.update_time < (timeout || 24*60*60*1000))) {
		need_update = true;
		user.update_time = now; //error. not updated yet.
	}
	//questions
	if (need_update || user.solutions === undefined && !user.solutions_pending) {
		user.solutions_pending = true;
		saveDB();
		getURL('https://toster.ru/user/'+nickname+'/questions',(text)=>{
			delete user.solutions_pending;
			//solutions
			let r = /\s*(\d+)\s*<\/div>/g; //todo: very very bad, need better algorytm!
			let a;
			let sum = 0;
			while ((a = r.exec(text)) !== null) {
				if (a[1] !== "0") sum++; //count questions with at least 1 answer
			}
			a = text.match(/icon_svg icon_check/g);
			let cnt = a && a.length || 0;
			if (!sum) user.solutions = '0';
			else user.solutions = Math.floor( cnt / sum * 100);
			//stats
			a = text.match(/<li class="inline-list__item inline-list__item_bordered">[\s\S]*<meta itemprop="interactionCount"[\s\S]*<div class="mini-counter__count">(\d+)[\s\S]*<div class="mini-counter__count">(\d+)[\s\S]*<div class="mini-counter__count mini-counter__count-solutions">(\d+)/);
			if (a) {
				user.cnt_q = a[1]; //questions
				user.cnt_a = a[2]; //answers
				user.cnt_s = a[3]; //perc solutions
			} else console.log("Stats not found, user:",nickname);
		});
	}
	//karma & stats from habr
	if (need_update || user.karma === undefined && !user.karma_pending) {
		user.karma_pending = true;
		saveDB();
		getURL('https://habr.com/users/'+nickname+'/',(text)=>{
			delete user.karma_pending;
			let a = /<div class="stacked-counter__value[^>]*>(.*)<\/div>\s*<div class="stacked-counter__label">Карма<\/div>/.exec(text);
			if (a) {
				user.karma = a[1].replace(',','.').replace('–','-');
				let karma = parseFloat(user.karma);
				if (!isNaN(karma)) { // !!!
					if (localStorage.cut_karma == 1) karma = Math.floor(karma);
					user.karma = karma;
				}
			} else {
				user.karma = "read-only";
				//console.log('Karma not found, user:',nickname);
			}
			a = /<span class="tabs-menu__item-counter tabs-menu__item-counter_total" title="Публикации: (\d+)">/.exec(text);
			if (a) {
				user.stat_pub = parseInt(a[1]);
			}
			a = /<span class="tabs-menu__item-counter tabs-menu__item-counter_total" title="Комментарии: (\d+)">/.exec(text);
			if (a) {
				user.stat_comment = parseInt(a[1]);
			}
		}, ()=>{ delete user.karma_pending; user.karma = 'не зарегистр.'; });
	}
}

function parseTags(txt) {
	let tags = {};
	let r = /<a href="https?:\/\/toster\.ru\/tag\/([^">]*)">\s*([\S ]+?)\s*<\/a>/g
	let a = r.exec(txt);
	while (a) {
		tags[a[1]] = a[2];
		a = r.exec(txt);
	}
	return tags;
}

function analyzeQuestion(question_id, now) {
	if (!now) now = (new Date()).getTime();
	let q = {is_pending:true, ut:now};
	db.question[question_id] = q;
	saveDB();
	getURL('https://toster.ru/q/' + question_id, function(text) {
		//get title
		const index_title_str = '<h1 class="question__title" itemprop="name ">';
		let index_title = text.indexOf(index_title_str);
		if (index_title > -1) {
			let index_title2 = text.indexOf("</h1>\n",index_title);
			let txt = text.substring(index_title + index_title_str.length + 1, index_title2).trim();
			if (txt) q.t = txt; //title!
		}
		//get user name
		let index_name = text.indexOf('<meta itemprop="name" content="');
		if (index_name > -1) {
			let index_name2 = text.indexOf('</span>', index_name);
			let txt = text.substr(index_name, index_name2 - index_name);
			let user_name = txt.match(/<meta itemprop=\"name\" content=\"([^"]*)\">/)[1];
			//console.log('user_name',user_name);
			let user_nickname = txt.match(/<meta itemprop=\"alternateName\" content=\"([^"]*)\">/)[1];
			//console.log('user_nickname',user_nickname);
			if (user_nickname) {
				delete q.is_pending;
				q.user_id = user_nickname;
				let user = db.user[user_nickname];
				if (!user) user = db.user[user_nickname] = {};
				user.name = user_name;
				user.nickname = user_nickname;
				updateUser(user_nickname);
			}
		}
		//get question tags
		let index_tags = text.indexOf('<ul class="tags-list">');
		if (index_tags > -1) {
			let index_tags2 = text.indexOf('</ul>', index_tags || 0);
			let txt = text.substr(index_tags, index_tags2 - index_tags);
			q.tags = parseTags(txt);
		}
		//check subscribtions
		if (text.indexOf('"btn btn_subscribe btn_active"') > -1) q.sb = 1;
		else {
			delete q.sb;
		}
	});
	return q;
}

let db;
function reset_db() {
	db = {
		user:{}, // user_id => { name: name, nickname: nickname, ... }
		question:{}, // q_id => { is_pending:bool, user_id:string, ut:integer }
	};
}
reset_db();

function load_db() {
	try {
		db = JSON.parse(localStorage.db);
	} catch(e) {
		//
	}
}
if (localStorage.save_form_to_storage) { //last added option (reset on each update)
	load_db();
}

let outer_tag = ()=>{};

var condition_error_string;
//Prepare environment and call eval()
function checkCondition(cond, current_data) {
	condition_error_string = '';
	//Special function triggered from eval() - check if a question has the tag
	outer_tag = function(s) {
		let tag_lower = s.toLowerCase();
		let tags = current_data.q.tags;
		if (!tags) return false;
		for(let k in tags) {
			if (tags[k].toLowerCase() == tag_lower) return true;
		}
		return false;
	}
	//Environment
	let env;
	if (current_data.u) {
		env = {
			questions: current_data.u.cnt_q || 999,
			answers: current_data.u.cnt_a || 999,
			solutions: current_data.u.solutions || 100,
			karma: current_data.u.karma || 0,
			comments: current_data.u.stat_comment || 0,
			articles: current_data.u.stat_pub || 0,
			nickname: current_data.u.nickname || '',
			title: current_data.q.t || '', //текст вопроса
			views: current_data.q.v || 0,
		}
		env.q = env.questions;
		env.a = env.answers;
		env.s = env.solutions;
		env.k = env.karma;
		env.c = env.comments;
		env.publications = env.articles;
		env.p = env.publications;
		env.nick = env.nickname;
		env.n = env.nick;
		env.t = env.title;
		env.v = env.views;
	} else env = current_data;
	try {
		return eval.lite(cond, env);
	} catch(e) {
		if ((typeof e == 'object') && (typeof e.message == 'string')) condition_error_string = e.message;
		else condition_error_string = e + '';
		return false;
	}
}


let c_kick_truba;
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
	if(!db) reset_db(); //imppossible. for debugging
	if (request.type == "getQuestions") {
		let a = {};
		let now = (new Date()).getTime();
		request.arr.forEach(data=>{
			let q_id = data.id-0;
			let question = db.question[q_id];
			if (question) {
				question.ut = now;
				if (data.v) question.v = data.v-0;
				let user_id = question.user_id;
				let user = user_id && db.user[user_id];
				let tags = question.tags;
				if (tags) {
					for(let k in tags) {
						if (db_tags_blacklist[tags[k].toLowerCase()]) {
							a[q_id] = {hide:true, q:question};
							if (user) a[q_id].u = user;
							return;
						}
					}
				}
				if (user) {
					let current_data = {q:question, u:user};
					a[q_id] = current_data;
					updateUser(user_id);
					//Проверка доп. условий
					for(let i=0;i<db_conditions.length;i++){
						let rule = db_conditions[i];
						if (checkCondition(rule.cond, current_data)) {
							if (rule.act == 'hide') current_data.hide = true;
							else if (rule.act == 'notify') continue; //при раскраске нам это не нужно
							else current_data.color = rule.act;
							break;
						}
					}
				}
				else if (!question.is_pending) analyzeQuestion(q_id, now);
			}
			else {
				question = analyzeQuestion(q_id, now);
				if (data.v) question.v = data.v-0;
			}
		});
		sendResponse(a);
	} else if (request.type == "getUsers") {
		let u = {};
		for(let nickname in request.arr) {
			let user = db.user[nickname];
			if (user) {
				u[nickname] = user;
			}
			if (request.arr[nickname] === 1) {
				//console.log('Fast update:',nickname);
				updateUser(nickname, 300000);
			}
			else updateUser(nickname);
		}
		sendResponse(u);
	} else if (request.type == "getOptions") {
		let options = {};
		TOSTER_OPTIONS.forEach((opt)=>{
			options[opt] = parseFloat(localStorage[opt]) || 0;
		});
		sendResponse(options);
	} else if (request.type == "getOptionsHabr") {
		let options = {};
		HABR_OPTIONS.forEach((opt)=>{
			options[opt] = parseInt(localStorage[opt]);
		});
		if (localStorage.habr_fix_lines == 1) {
			options.habr_css = habr_css_fix_lines;
		}
		sendResponse(options);
	} else if (request.type == "getNotifications") {
		let now = (new Date()).getTime();
		let el_hash = {	hash:events_list_navbar_hash };
		if (now - notifications_pause < 30000) { //Выдерживаем паузу.
			sendResponse({1:el_hash}); //Но не обнуляем
			return;
		}
		if (now - tm_browser_load < 60000) { //После загрузки расширения не паникуем, не спамим, молчим.
			arr_notifications = {}; //Сливаем все уведомления в трубу.
			if (c_kick_truba===undefined) {
				c_kick_truba=false;
				console.log('Уведомления временно отключены');
			}
		} else if(!c_kick_truba) {
			c_kick_truba = true;
			console.log('Уведомления включены');
		}
		
		getNotifications_last_time = now;
		for(q_id in arr_notifications) { //Чистим от старых
			let item = arr_notifications[q_id];
			if (now - item.tm > 40000) {
				console.log('Удаляем по таймауту',now,arr_notifications[q_id]);
				delete arr_notifications[q_id];
			}
		}
		//console.log('Отправляем уведомления:',Object.keys(arr_notifications).length);
		arr_notifications[1] = el_hash;
		sendResponse(arr_notifications);
		arr_notifications = {};
	} else if (request.type == "disableNotifications") {
		localStorage.enable_notifications = 0;
	} else if (request.type == "tabIsActive") {
		//console.log('Активная вкладка! Продеваем паузу');
		notifications_pause = (new Date()).getTime();
	} else if (request.type == "updateIconNum") {
		if (request.hash != events_list_navbar_hash) {
			events_list_navbar_hash = request.hash;
			events_list_navbar = request.html;
			//console.log('Новый хеш от страницы:',request.hash,request.html);
		}
		chrome.browserAction.setBadgeText({text:""+request.cnt});
	} else if (request.type == "getSubStatus") {
		let qnum = request.qnum;
		let question = db.question[qnum];
		sendResponse(question && !!question.sub);
	} else if (request.type == "setSubStatus") {
		let qnum = request.qnum;
		let question = db.question[qnum];
		if (!question) question = analyzeQuestion(qnum);
		if (question.sub) {
			delete question.sub;
		} else {
			question.sub = 1;
		}
		question.ut = (new Date()).getTime();
		sendResponse(!!question.sub);
		saveDB();
	} else if (request.type == "directQuestionUpdate") {
		if (!request.nickname || !request.q_id) return;
		let q = db.question[request.q_id];
		if (!q) {
			q = {};
			db.question[request.q_id] = q;
		}
		q.user_id = request.nickname;
		if (request.tags_html) q.tags = parseTags(request.tags_html);
		if (request.title) q.t = request.title;
		if (request.sb) q.sb = 1;
		else if (request.sb === false) delete q.sb;
		q.ut = (new Date()).getTime();
	} else if (request.type == "getAside") {
		//console.log('Посылаем хеш:',events_list_navbar_hash,events_list_navbar);
		sendResponse({
			html:events_list_navbar,
			hash:events_list_navbar_hash,
		});
	}
});


let TOSTER_OPTIONS = [
	'swap_buttons', 'hide_sol_button', 'show_habr', 'hide_word_karma',
	'show_name', 'show_nickname', 'hide_offered_services', 'use_ctrl_enter',
	'top24_show_tags', 'top24_show_author', 'hide_solutions', 'save_form_to_storage',
	'make_dark', 'enable_notifications', 'notify_if_inactive',
	//'always_notify_my_questions', 'notify_about_likes', 'notify_about_solutions',
	'datetime_replace', 'datetime_days', 'show_blue_circle', 'notify_all',
];

let HABR_OPTIONS = [
	'move_posttime_down','move_stats_up', 'hide_comment_form_by_default',
];

if (localStorage.notify_my_feed === undefined) { //last added option
	//Toster options
	if (localStorage.swap_buttons === undefined) localStorage.swap_buttons=0;
	if (localStorage.hide_sol_button === undefined) localStorage.hide_sol_button=0;
	if (localStorage.show_habr === undefined) localStorage.show_habr=1;
	if (localStorage.hide_word_karma === undefined) localStorage.hide_word_karma=0;
	if (localStorage.show_name === undefined) localStorage.show_name=0;
	if (localStorage.show_nickname === undefined) localStorage.show_nickname=1;
	if (localStorage.hide_offered_services === undefined) localStorage.hide_offered_services=0;
	if (localStorage.use_ctrl_enter === undefined) localStorage.use_ctrl_enter=0;
	if (localStorage.top24_show_tags === undefined) localStorage.top24_show_tags=0;
	if (localStorage.top24_show_author === undefined) localStorage.top24_show_author=1;
	if (localStorage.hide_solutions === undefined) localStorage.hide_solutions=0;
	if (localStorage.save_form_to_storage === undefined) localStorage.save_form_to_storage=0;
	if (localStorage.fixed_a_bug === undefined) localStorage.fixed_a_bug=1; //he-he
	if (localStorage.make_dark === undefined) localStorage.make_dark=0;
	if (localStorage.all_conditions === undefined) localStorage.all_conditions="tag('JavaScript') = #ffc";
	if (localStorage.enable_notifications === undefined) localStorage.enable_notifications=0;
	if (localStorage.notify_if_inactive === undefined) localStorage.notify_if_inactive=0; //notify_if_inactive_only
	if (localStorage.always_notify_my_questions === undefined) localStorage.always_notify_my_questions=1;
	if (localStorage.notify_about_likes === undefined) localStorage.notify_about_likes=0;
	if (localStorage.notify_about_solutions === undefined) localStorage.notify_about_solutions=0;
	if (localStorage.datetime_replace === undefined) localStorage.datetime_replace=0;
	if (localStorage.datetime_days === undefined) localStorage.datetime_days=0;
	if (localStorage.notify_all === undefined) localStorage.notify_all=0;
	if (localStorage.notify_my_feed === undefined) localStorage.notify_my_feed=0;
	if (localStorage.enable_notify_action === undefined) localStorage.enable_notify_action=0;
	if (localStorage.show_blue_circle === undefined) localStorage.show_blue_circle=1; //подписки
	if (localStorage.notify_mention === undefined) localStorage.notify_mention=1;
	if (localStorage.notify_expert === undefined) localStorage.notify_expert=1;
	if (localStorage.notify_answer_comment === undefined) localStorage.notify_answer_comment=0;
	if (localStorage.notify_changes === undefined) localStorage.notify_changes=0;
	//Habr options
	if (localStorage.move_posttime_down === undefined) localStorage.move_posttime_down=0;
	if (localStorage.move_stats_up === undefined) localStorage.move_stats_up=0;
	if (localStorage.hide_comment_form_by_default === undefined) localStorage.hide_comment_form_by_default=0;
	if (localStorage.habr_fix_lines === undefined) localStorage.habr_fix_lines=0;
}

//--------- DEBUG ---------

function count_obj(obj) {
	let cnt = 0;
	for(let k in obj) cnt++;
	return cnt;
}

// -------------- BLACKLIST -----------

let db_tags_blacklist = {}
function update_blacklist() {
	db_tags_blacklist = {};
	const lines = localStorage.tag_blacklist.split("\n");
	for(let i=0;i<lines.length;i++) {
		const tag = lines[i].trim();
		if (!tag) continue;
		db_tags_blacklist[tag.toLowerCase()] = true;
	}
}
if (localStorage.tag_blacklist) update_blacklist();

// ------------ Дополнительные условия показа вопросов -------------


const isValidAction_image = document.createElement("img");
function isValidAction(stringToTest) {
	if (stringToTest === 'hide' || stringToTest === 'notify') return true;
	if (!stringToTest || stringToTest === 'inherit' || stringToTest === 'transparent') return false;

	let image = isValidAction_image;
	image.style.color = "rgb(0, 0, 0)";
	image.style.color = stringToTest;
	if (image.style.color !== "rgb(0, 0, 0)") { return true; }
	image.style.color = "rgb(255, 255, 255)";
	image.style.color = stringToTest;
	return image.style.color !== "rgb(255, 255, 255)";
}

let example_environment = {
	questions: 1, q:1,
	answers: 1, a:1,
	solutions: 100, s:100,
	karma: 0, k:0,
	comments: 0, c:0,
	articles: 0, publications:0, p:0,
	nickname: 'admin', nick:'admin', n:'admin',
	title: 'Toster?', t:'Toster?',
	views: 0, v:0,
}
var cond_update_error_string;
let db_conditions = [];
let db_conditions_hide_cnt = 0;
let db_conditions_notify_cnt = 0;
function getDbCondLength() {
	return db_conditions_notify_cnt;
}
function update_conditions() {
	cond_update_error_string = '';
	db_conditions = [];
	db_conditions_hide_cnt = 0;
	db_conditions_notify_cnt = 0;
	const lines = localStorage.all_conditions.split("\n");
	for(let i=0;i<lines.length;i++) {
		let rule = lines[i].trim(); //Строка, содержащая отдельное правило
		if (rule.indexOf('//') !== -1) rule = rule.split('//')[0].trim();
		if (!rule) {
			//Пустая строка или комментарий
			continue;
		}
		let eq_idx = rule.lastIndexOf('='); //Последний знак "="
		if (eq_idx < 1 || rule[eq_idx-1] == '=') {
			if(!cond_update_error_string) cond_update_error_string = 'Line #'+(i+1)+': '+rule+' не является правилом.';
			continue;
		}
		let rule_cond_str = rule.substring(0,eq_idx).trim(); //Условие правила - eval(rule_cond_str)
		let rule_action_str = rule.substring(eq_idx+1).trim(); //Действие правила - #ff0 или hide
		if (!rule_action_str) {
			if(!cond_update_error_string) cond_update_error_string = 'Line #'+(i+1)+': не задано действие.';
			continue;
		}
		if (rule_action_str.toLowerCase() == 'hide') {
			rule_action_str = 'hide';
			db_conditions_hide_cnt++;
		}
		if (rule_action_str.toLowerCase() == 'notify') {
			rule_action_str = 'notify';
			db_conditions_notify_cnt++;
		}
		if (!isValidAction(rule_action_str)) {
			if(!cond_update_error_string) cond_update_error_string = 'Line #'+(i+1)+': '+rule_action_str+' не является валидным действием.';
			continue;
		}
		db_conditions.push({
			cond: rule_cond_str,
			act: rule_action_str,
		});
		//test condition
		checkCondition(rule_cond_str, example_environment);
		if (condition_error_string && !cond_update_error_string) cond_update_error_string = 'Line #'+(i+1)+': '+condition_error_string;
	}
	if (!cond_update_error_string && db_conditions_notify_cnt && localStorage.enable_notify_action != 1) {
		cond_update_error_string = 'Действите notify отключено в настройках выше.';
	}
	if (!cond_update_error_string) cond_update_error_string = '&nbsp;';
	return db_conditions_notify_cnt;
}
if (localStorage.all_conditions) setTimeout(update_conditions,0); //because eval.lite is not defined yet

//---------------------Notofocations------------------------

let notify_feed_arr = {}; //Массив с id вопросов, по которым уже было уведомление
function clearNotifyFeedArr(now) {
	Object.keys(notify_feed_arr).forEach(id=>{
		let q = db.question[id];
		if (!q || now - q.ut > 9900000) delete notify_feed_arr[id];
	});
	localStorage.save_notify_feed_arr = JSON.stringify(notify_feed_arr);
}
if (localStorage.save_notify_feed_arr) notify_feed_arr = JSON.parse(localStorage.save_notify_feed_arr);

const FRESH_TIME = { //только что, минуту назад, 2 минуты назад, 3 минуты назад
	'только что':0,
	'минуту назад':1,
	'2 минуты назад':2,
	'3 минуты назад':3,
	'4 минуты назад':4,
	'5 минут назад':5,
	'6 минут назад':6,
	'7 минут назад':7,
	'8 минут назад':8,
	'9 минут назад':9,
	'10 минут назад':10,
};
function getFreshTime(time_str) {
	return FRESH_TIME[time_str] === undefined ? 99 : FRESH_TIME[time_str];
}

function updateNitificationsMyFeed(now) {
	let xhr = new XMLHttpRequest();
	const url = 'https://toster.ru/my/feed';
	xhr.open('GET', url, true);
	xhr.send();
	xhr.onload = function() {
		if (xhr.status != 200) return;
		function checkQuestion(q_id) {
			if (notify_feed_arr[q_id] || arr_notifications[q_id]) return;
			let q = db.question[q_id];
			if (save_current_user && save_current_user == q.user_id) return;
			if (db_conditions_hide_cnt) { //есть правила
				if (q.is_pending) return;
				let user = q.user_id && db.user[q.user_id];
				if (!user || user.karma_pending || user.solutions_pending) return;
				//Check rules
				let current_data = {
					q:q,
					u:user,
				}
				for(let i=0;i<db_conditions.length;i++) {
					let rule = db_conditions[i];
					if (!checkCondition(rule.cond, current_data)) continue;
					//Сработало условие
					if (rule.act == 'hide') return;
					else break; //Сработал либо цвет, либо правило на уведомление => хороший вопрос.
				}
			}
			//Ни одна блокировка не сработала.
			arr_notifications[q_id] = {
				q_id:q_id,
				title:q.t,
				//e:1,
				w:'Моя лента - новый вопрос',
			}
			notify_feed_arr[q_id]=1;
		}
		let r = /<h2 class="question__title">\s*<a class="question__title-link question__title-link_list" href="https:\/\/toster\.ru\/q\/(\d+)">\s*(.*?)<\/a>[\S\s]*?<time class="question__date[^>]*>\s*(.+)<\/time>[\S\s]*?<span class="question__views-count">\s*(\d+)/g;
		let m;
		let arr=[];
		while (m = r.exec(xhr.response)) {
			let q_id = m[1]-0;
			arr.push(q_id);
			let title = m[2].trim();
			let date = m[3].trim();
			let views = m[4]-0;
			if (getFreshTime(date) > 10) continue;
			let q = db.question[q_id];
			if (!q) {
				q = analyzeQuestion(q_id);
				q.t = title;
				setTimeout(()=>{
					checkQuestion(q_id);
				},4500); //fast enough
				continue;
			}
			q.v = views;
			q.ut = now;
			checkQuestion(q_id);
		}
		clearNotifyFeedArr(now);
		//console.log('My feed:',arr);
	}
}

function updateNitificationsFilterAll(now) {
	if (db_conditions_notify_cnt == 0) return; //Нет правил, нет смысла проверять.
	let xhr = new XMLHttpRequest();
	const url = 'https://toster.ru/questions';
	xhr.open('GET', url, true);
	xhr.send();
	xhr.onload = function() {
		if (xhr.status != 200) return;
		function checkQuestion(q_id) {
			if (notify_feed_arr[q_id] || arr_notifications[q_id]) return;
			let q = db.question[q_id];
			if (q.is_pending) return;
			if (save_current_user && save_current_user == q.user_id) return;
			let user = q.user_id && db.user[q.user_id];
			if (!user || user.karma_pending || user.solutions_pending) return;
			//Check rules
			let tags = q.tags;
			if (tags) {
				for(let k in tags) {
					if (db_tags_blacklist[tags[k].toLowerCase()]) return;
				}
			}
			let current_data = {
				q:q,
				u:user,
			}
			for(let i=0;i<db_conditions.length;i++) {
				let rule = db_conditions[i];
				if (!checkCondition(rule.cond, current_data)) continue;
				//Сработало правило
				if (rule.act == 'hide') return; //плохой вопрос
				else if (rule.act != 'notify') continue; //цвета игнорируем
				arr_notifications[q_id] = {
					q_id:q_id,
					title:q.t,
					//e:1,
					w:'Новый интересный вопрос',
				}
				notify_feed_arr[q_id]=1;
				return;
			}
		}
		let r = /<h2 class="question__title">\s*<a class="question__title-link question__title-link_list" href="https:\/\/toster\.ru\/q\/(\d+)">\s*(.*?)<\/a>[\S\s]*?<time class="question__date[^>]*>\s*(.+)<\/time>[\S\s]*?<span class="question__views-count">\s*(\d+)/g;
		let m;
		let arr=[];
		while (m = r.exec(xhr.response)) {
			let q_id = m[1]-0;
			let title = m[2].trim();
			let date = m[3].trim();
			let views = m[4]-0;
			arr.push({
				id:q_id,
				is_q:!!db.question[q_id],
				title:title,
				v:views,
				date:date,
				q:db.question[q_id],
			});
			if (getFreshTime(date) > 10) continue;
			let q = db.question[q_id];
			if (!q) {
				q = analyzeQuestion(q_id);
				q.t = title;
				setTimeout(()=>{
					checkQuestion(q_id);
				},4500);
				continue;
			}
			q.v = views;
			q.ut = now;
			checkQuestion(q_id);
		}
		clearNotifyFeedArr(now);
		//console.log('Новые вопросы:',arr);
	}
}

String.prototype.fastHashCode = function() {
	if (this.length === 0) return 0;
	let hash = 0;
	for (let i = 0; i < this.length; i++) {
		hash = ((hash<<5)-hash)+this.charCodeAt(i);
		hash = hash & hash; //32bit
	}
	return hash;
}

let events_list_navbar = ''; //events-list_navbar innerHTML
let events_list_navbar_hash = 0;

chrome.browserAction.setBadgeBackgroundColor({color:"#777"});
var arr_notifications = {};
let notifications_timer;
let notifications_pause = 0; //Метка активации паузы. 30 секунд нельзя спамить.
const tm_browser_load = (new Date()).getTime();
let getNotifications_last_time = 0; //Последнее обращение страницы.
let save_current_user = ''; //Текущий пользователь, или прошлый.
//let start_page = 10;
function updateNotificationOptions() {
	if (notifications_timer !== undefined) {
		clearInterval(notifications_timer);
		notifications_timer = undefined;
		//console.log('notifications disabled');
	}
	if (localStorage.enable_notifications == 1) {
		//console.log('notifications enabled');
		notifications_timer = setInterval(()=>{
			//let now = (new Date()).getTime();
			//if (now - getNotifications_last_time < 60000) return; //Страница не отвечает (никакая).
			let xhr = new XMLHttpRequest();
			let url = 'https://toster.ru/my/tracker';
			//let url = 'https://toster.ru/tracker/feed?page='+start_page;
			//console.log('----------Страница:',start_page);
			//start_page++;
			//if (start_page>75) start_page=75;
			xhr.open('GET', url, true);
			xhr.send();
			xhr.onload = function() {
				let now = (new Date()).getTime();
				if (xhr.status != 200) return;
				//Глобальное объявление
				let m = xhr.response.match(/<div class="alert[ "]{1}[^>]*>\s*(.*)/);
				if (m) {
					let message = m[1].trim();
					if (m = message.match(/^(.*)<a class="alert__btn_close/)) message = m[1].trim();
					if (message && localStorage.save_global_alert != message) {
						localStorage.save_global_alert = message;
						arr_notifications[1] = {
							w: 'Объявление',
							title: message,
							is_alert: true,
						};
					}
				}
				//Текущий пользователь
				let current_user;
				//if (localStorage.always_notify_my_questions == 1) {
				m = xhr.response.match(/<a class="user-panel__user-name" href="https:\/\/toster\.ru\/user\/([^"]+)">/);
				if (m) {
					current_user=m[1];
					save_current_user = current_user;
				}
				//Считаем кол-во уведомлений
				if (localStorage.enable_notifications == 1) {
					let cnt = 0;
					const START_HTML = '<ul class="events-list events-list_navbar">';
					let start = xhr.response.indexOf(START_HTML);
					let end = xhr.response.indexOf('</ul>',start);
					if (start > -1 && end > -1) {
						let aside_notifications = xhr.response.substring(start+START_HTML.length,end); //innerHTML
						let hash = aside_notifications.fastHashCode();
						if (hash !== events_list_navbar_hash) {
							events_list_navbar_hash = hash;
							events_list_navbar = aside_notifications;
							//console.log('Загружен новый хеш:',hash,aside_notifications);
						}
						//console.log("aside",aside_notifications);
						let m = aside_notifications.match(/<a class="link_light-blue" href="https:\/\/toster\.ru\/my\/tracker">\s*.*\s*<span>(\d+)<\/span>/m);
						if (m) {
							cnt = m[1]-0;
						} else {
							m = aside_notifications.match(/<li class=[^>]*>\s*<a/gm);
							let li_cnt = m ? m.length : 0;
							cnt = li_cnt;
						}
					}
					//console.log("cnt:",cnt);
					chrome.browserAction.setBadgeText({text:""+cnt});
				}
				//Обрезаем и берем главный список
				let start = xhr.response.indexOf('<section class="page__body"');
				let end = xhr.response.indexOf('</section>',start);
				if (start === -1 || end === -1) return console.log('Ошибка парсинга трекера уведомлений');
				let html = xhr.response.substring(start,end);
				let notify_all = localStorage.notify_all==1;
				//Парсим на отдельные секции вопросов
				let r = /<a class="question__title-link" href="https:\/\/toster\.ru\/q\/(\d+)">\s*(.*?)<\/a>[\s\S]*?<ul class="events-list">([\s\S]*?)<\/ul>/g;
				while (m = r.exec(html)) {
					let Q_id = m[1]-0;
					let Q_title = m[2].trim(); //console.log('Title:',Q_title);
					let ul = m[3];
					let q = db.question[Q_id];
					if (!q) q = analyzeQuestion(Q_id, now);
					let renamed, noticed;
					if (q.t != Q_title) {
						renamed = !!q.t;
						q.t = Q_title; //Быстрый синхронный title
						saveDB();
					}
					let must_notify = notify_all || q.sub
						|| current_user && q.user_id == current_user && localStorage.always_notify_my_questions==1;
					let rr = /<input type="checkbox" class="event__checkbox" data-event_id="(\d+)"\s*([^>]*)>[\s\S]*?<div class="event__title">([\S\s]*?)<div class="event__date">(.*?)<\/div>/g;
					while (m = rr.exec(ul)) {
						let e = m[1]-0;
						let active = m[2] == 'checked';
						if (!active) continue;
						let message = m[3];
						let date = m[4].trim(); //только что, минуту назад, 2 минуты назад, 3 минуты назад
						if (getFreshTime(date) > 1) continue;
						//console.log(active,e,date);
						let a = { //action
							e:e, active:active, date:date, message:message, q:q, //renamed:renamed,
						}
						if (message.length > 500) {
							console.log('Слишком длинное уведомление',a);
							continue; //possible error
						}
						let nickname = (m = message.match(/<a\s\S*?\s*?href="https:\/\/toster\.ru\/user\/(.*?)"/)) && m[1];
						a.nickname = nickname;
						if (message.indexOf('Модератор ') > -1) { //moderator
							if (!must_notify && !(localStorage.notify_moderator==1)) continue;
							if (message.indexOf('Модератор принял вашу правку вопроса') > -1) {
								a.what = 'Модератор принял правку';
							} else if (message.indexOf('Модератор удалил') > -1) {
								//Модератор удалил ответ от&nbsp;<a href="https://toster.ru/user/unsstrennen">unsstrennen</a>, на который вы жаловались с причиной: «Это какая-то реплика, а не ответ»
								a.what = 'Модератор удалил '+
									(message.indexOf('ответ') > -1? 'ответ' :
										(message.indexOf('вопрос') > -1? 'вопрос' :
											(message.indexOf('комментарий') > -1? 'комментарий' : 'что-то')
										)
									)
								;
								if (m = message.match(/причиной: «(.*)»/)) a.title = 'Причина: '+m[1].trim();
							} else {
								console.log('Неизвестное действие модератора',a);
								a.what = 'Модератор что-то сделал';
							}
						} else if (!nickname) {
							console.log('Не обнаружен автор уведомления!',a);
							continue;
						} else if (message.indexOf('принял вашу правку вопроса') > -1) {
							if (!must_notify && !(localStorage.notify_changes==1)) continue;
							a.what = 'Автор принял правку';
						} else if (message.indexOf('просит вас как эксперта ответить на вопрос') > -1) {
							if (!must_notify && !(localStorage.notify_expert==1)) continue;
							a.title = nickname + ' просит вас как эксперта ответить на вопрос';
							a.what = 'Эксперт нужен!';
						} else if (message.indexOf('подписался на') > -1) { //ваш вопрос
							if (!must_notify && !(localStorage.notify_about_likes==1)) continue;
							a.what = 'Подписка на вопрос ('+nickname+')';
							//a.title = nickname + ' подписался на ваш вопрос.';
						} else {
							let spaces,q_id,e2,anchor,what,url;
							m = message.match(/(\s*)<a href\s?=\s?"https:\/\/toster\.ru\/\q\/(\d+)\?e=(\d+)[^#]*#?([^>]*)">([^<]+)<\/a>/);
							if (!m && (m = message.match(/(\s*)<a href\s?=\s?"https:\/\/toster\.ru\/questionversion\?question_id=(\d+)&e=(\d+)[^#]*#?([^>]*)">([^<]+)<\/a>/))) {
								url = message.match(/<a href\s?=\s?"(https:\/\/toster\.ru\/questionversion[^"]*)"/);
								if (url) a.url = url[1];
							}
							if (m) {
								//spaces = m[1];
								q_id=m[2]-0;
								if (q_id != Q_id) {
									console.log('ID вопроса не соответствует записи!',q_id,Q_id,a);
									continue;
								}
								e2=m[3]-0;
								if (e2 != e) {
									console.log('ID события не соответствует записи!',e2,a.e,a);
									continue;
								}
								anchor = m[4];
								what = m[5].trim();
								//a.spaces_len = spaces.length;
								a.anchor = anchor;
								a.what = what;
							} else {
								console.log('Нельзя получить ссылку на событие!',a);
								continue;
							}
							if (message.indexOf('написал') > -1) {
								//написал \n <a href="https://toster.ru/q/621216?e=7482397#comment_1877510">комментарий</a> \n к&nbsp;ответу на&nbsp;вопрос
								if (!must_notify && !(localStorage.notify_answer_comment==1)) continue;
								if (what == 'комментарий' || what=='ответ') what = 'Новый '+what;
							} else if (message.indexOf('отметил решением') > -1) {
								if (!must_notify && !(localStorage.notify_about_solutions==1)) continue;
								if (what == 'ответ' || what == 'ваш ответ') what = 'Выбрано решение';
							} else if (message.indexOf('понравился') > -1) {
								if (!must_notify && !(localStorage.notify_about_likes==1)) continue;
								if (what == 'ваш ответ') what='Лайк';
							} else if (message.indexOf('упомянул вас в') > -1) {
								if (!must_notify && !(localStorage.notify_mention==1)) continue;
								if (what == 'комментарии' || what == 'ответе') what = 'Вас упомянули';
							} else if (message.indexOf('изменил&nbsp;свой') > -1) {
								if (!must_notify && !(localStorage.notify_changes==1)) continue;
								if (what == 'ответ' || what == 'вопрос') what = 'Изменение '+what+'а от '+nickname;
							} else if (what == 'правку') {
								if (!must_notify && !(localStorage.notify_changes==1)) continue;
								what = 'Предложение правки ('+nickname + ')';
							}
							a.what = what;
							a.anchor = anchor;
							if (!what || what.match(/^[а-яa-z0-9 ]/)) {
								console.log('Не удалось распознать уведомление',a);
								continue;
							}
						}
						//q.ut = now; //if (!q.is_pending) 
						if (!q.e || q.e < e) { //Новые данные
							q.e = e;
							q.ut = now;
							let notif = arr_notifications[Q_id];
							if(!notif) {
								notif = {
									q_id:Q_id,
									title:(a.title || q.t), //+ "\n" + a.date,
								};
								//console.log('Новое уведомление:',notif);
								arr_notifications[Q_id]=notif;
							}
							notif.e = e;
							if (a.what) notif.w = a.what;
							if (a.anchor) notif.anchor=a.anchor;
							if (a.url) notif.url = a.url;
							notif.tm = now; //not used
							noticed = true;
							//console.log('Уведомление:',a);
						}
					}
					if (renamed && !noticed) { //Вопрос переименован
						if (!must_notify && !(localStorage.notify_changes==1)) continue;
						let notif = arr_notifications[Q_id];
						if(!notif) {
							notif = {
								q_id:Q_id,
							};
							arr_notifications[Q_id]=notif;
						}
						notif.title = q.t;
						notif.w = 'Вопрос переименован';
						notif.url = 'https://toster.ru/q/'+Q_id;
						notif.tm = now; //not used
					}
				}
			};
			let now = (new Date()).getTime();
			if (localStorage.notify_my_feed == 1) updateNitificationsMyFeed(now);
			if (localStorage.enable_notify_action == 1) updateNitificationsFilterAll(now);
		}, 15000);
	} else {
		chrome.browserAction.setBadgeText({text:""});
	}
}
updateNotificationOptions();

//---------------------- CSS --------------------

const habr_css_fix_lines = `
/* ---------- МАГИЯ --------- /*

/* Магия в комментариях */
.content-list__item_comment	 {
	/* Делаем вертикальные линии. */
	border-left: 1px solid #707070;
}

.comment__message {
	/* Делаем отсутп слева, выравнивание по положению ника (на глаз). */
	padding-left: 33px;
	/* В Chrome и Opera 12 - почти идеально. */;
}

.comment__footer {
	/* Кнопку "ответить" тоже сдвигаем вправо, выравниваем. */
	padding-left: 33px;
}

.comment__folding-dotholder {
	/* Удаление точки при наведении на комментарий. Типа спасибо. Возможно, было и удобно кому-то. */
	background: none;
	display: none !important;
}

.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
{
	border-left: 1px solid #ff7030;
	/* Делаем 17ю линию другим цветом, т.к. это предел вложенности. */;
}

.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment .content-list__item_comment
.content-list__item_comment
{
	border-left: none;
	/* Далее убираем. */;
}

.megapost-cover__img, .megapost-cover__img_darken, .megapost-cover__inner {
	background:none !important;
	background-color:white !important;
}

.megapost-cover__inner, .megapost-cover_short, .megapost-cover__img	 {
	height:auto !important;
}

.preview-data__title-link, .megapost-cover_light .list__item, .megapost-cover_light .list__item-link,
.megapost-cover_light .preview-data__blog-link, .megapost-cover_light .preview-data__time-published {
	color: black !important;
}
`;

//----------- daytime ---------

function updateDateTimeDays(val) { //callback function from options
	let temp = parseFloat(val);
	if (temp !== temp) temp = 0;
	localStorage.datetime_days = temp;
}
